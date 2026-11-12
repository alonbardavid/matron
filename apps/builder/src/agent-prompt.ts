import { loadOutcomeSchema, loadPrompt, promptPath, renderTemplate } from "./prompts.js";
import type { AgentPrompt, BuilderRun } from "./types.js";

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
    loadOutcomeSchema(promptsDir),
    "--settings",
    CLAUDE_SETTINGS_FILE,
    "--model",
    model,
  ];
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  return ["sh", "-c", 'cd "$0" && exec claude "$@"', repo, ...args];
}
