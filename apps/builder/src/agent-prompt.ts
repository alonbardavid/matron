import { loadPrompt, promptPath, renderTemplate } from "./prompts.js";
import { BRACKET_KINDS, type AgentPrompt, type BuilderRun } from "./types.js";

/**
 * What the agent gives to prepare the owner's review of the branch, kept on
 * the build session: a summary, and every change on it split into brackets.
 */
const PREPARING_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "Markdown for the reviewer: what the whole branch changes and how, in a few short paragraphs",
    },
    brackets: {
      type: "array",
      description:
        "Every changed line of the branch, grouped into what a reviewer should read together, in reading order",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "A few plain words" },
          kind: { type: "string", enum: BRACKET_KINDS },
          description: {
            type: "string",
            description: "What these lines do and why, in two to four sentences",
          },
          ranges: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string", description: "Repository-relative path" },
                start: {
                  type: "integer",
                  description: "First line, in the branch's version",
                },
                end: { type: "integer", description: "Last line, inclusive" },
                note: {
                  type: "string",
                  description: "One short sentence about these lines, or empty",
                },
              },
              required: ["path", "start", "end", "note"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "kind", "description", "ranges"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "brackets"],
  additionalProperties: false,
} as const;

/** The structured output every agent turn must end with. */
export const OUTCOME_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["done", "question", "blocked"] },
    summary: {
      type: "string",
      description: "One line describing the change, for a commit title",
    },
    reasoning: { type: "string", description: "Why the change was made this way" },
    message: { type: "string", description: "What to show the user, in markdown" },
    preparingReview: PREPARING_REVIEW_SCHEMA,
  },
  required: ["status", "summary", "reasoning", "message", "preparingReview"],
  additionalProperties: false,
} as const;

export const ALLOWED_TOOLS = ["Bash", "Read", "Edit", "Write", "Glob", "Grep"];

/** Where the hook settings the image ships live; `hook-guard.ts` is what they run. */
export const CLAUDE_SETTINGS_FILE = "/app/claude-settings.json";

/**
 * The prompt for one agent turn, rendered from the templates in the image.
 * A continuation in a fresh agent session (no session id yet) is given the
 * original build context first, since the agent has no memory of the branch.
 */
export function renderPrompt(
  run: BuilderRun,
  prompt: AgentPrompt,
  promptsDir: string,
  hasSession: boolean,
  /** Where the files that came with the message were written, if any. */
  attachments: string[] = [],
): string {
  const buildContext = (plan: string, files: string[]) =>
    renderTemplate(loadPrompt(promptsDir, "build"), {
      request: run.request,
      plan,
      branch: run.branch.name,
      extra: prompt.kind === "build" ? prompt.extra : "",
      attachments: attachmentsNote(files),
    });
  switch (prompt.kind) {
    case "build":
      return buildContext(
        run.plan ?? "(no plan was written; work from the request)",
        attachments,
      );
    case "fix":
      return renderTemplate(loadPrompt(promptsDir, "fix"), {
        command: prompt.command,
        output: prompt.output,
      });
    case "continue": {
      const text = renderTemplate(loadPrompt(promptsDir, "continue"), {
        message: prompt.message,
        sync: prompt.sync,
        attachments: attachmentsNote(attachments),
      });
      if (hasSession) return text;
      const context = buildContext(
        run.plan ??
          "(the plan is not available; the branch already contains the earlier work)",
        [],
      );
      return `${context}\n\n---\n\n${text}`;
    }
  }
}

/** Where the files that came with the user's words were written, for the prompt. */
function attachmentsNote(paths: string[]): string {
  if (paths.length === 0) return "";
  const what = paths.length === 1 ? "a file" : "files";
  return `The user attached ${what}, written for you to read (pictures and PDFs included) at:\n${paths.map((path) => `- ${path}`).join("\n")}`;
}

/**
 * The coding agent's command line for one turn, run in the checkout. Model
 * requests go to the placeholder host the harness intercepts; the real
 * gateway and its credentials are added outside the container.
 */
export function agentArgv(
  repo: string,
  promptsDir: string,
  model: string,
  resumeSessionId?: string,
): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    ALLOWED_TOOLS.join(","),
    "--append-system-prompt-file",
    promptPath(promptsDir, "system"),
    "--json-schema",
    JSON.stringify(OUTCOME_SCHEMA),
    "--settings",
    CLAUDE_SETTINGS_FILE,
    "--model",
    model,
  ];
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  return ["sh", "-c", 'cd "$0" && exec claude "$@"', repo, ...args];
}
