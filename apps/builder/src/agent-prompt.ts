import { loadPrompt, promptPath, renderTemplate } from "./prompts.js";
import type { AgentPrompt, BuilderJob } from "./types.js";

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
  },
  required: ["status", "summary", "reasoning", "message"],
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
  job: BuilderJob,
  prompt: AgentPrompt,
  promptsDir: string,
  hasSession: boolean,
): string {
  const buildContext = (plan: string) =>
    renderTemplate(loadPrompt(promptsDir, "build"), {
      request: job.request,
      plan,
      branch: job.branch.name,
      extra: prompt.kind === "build" ? prompt.extra : "",
    });
  switch (prompt.kind) {
    case "build":
      return buildContext(job.plan ?? "(no plan was written; work from the request)");
    case "fix":
      return renderTemplate(loadPrompt(promptsDir, "fix"), {
        command: prompt.command,
        output: prompt.output,
      });
    case "continue": {
      const text = renderTemplate(loadPrompt(promptsDir, "continue"), {
        message: prompt.message,
        sync: prompt.sync,
      });
      if (hasSession) return text;
      const context = buildContext(
        job.plan ??
          "(the plan is not available; the branch already contains the earlier work)",
      );
      return `${context}\n\n---\n\n${text}`;
    }
  }
}

/**
 * The coding agent's command line for one turn, run in the checkout. Model
 * requests go to the placeholder host the harness intercepts; the real
 * gateway and its credentials are added outside the container.
 */
export function agentArgv(
  repo: string,
  promptsDir: string,
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
  ];
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  return ["sh", "-c", 'cd "$0" && exec claude "$@"', repo, ...args];
}
