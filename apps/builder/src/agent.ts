import { combined, run, tail } from "./run.js";
import { promptPath } from "./prompts.js";
import { JobError, type AgentOutcome, type BuilderJob } from "./types.js";
import type { EventLog } from "./events.js";
import type { Paths } from "./state.js";

export const AGENT_TURN_TIMEOUT_MS = 40 * 60 * 1000;

/** The structured output every turn must end with. */
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

export const ALLOWED_TOOLS = "Bash,Read,Edit,Write,Glob,Grep";

export type AgentTurn = {
  prompt: string;
  resumeSessionId: string | null;
};

export type AgentTurnResult = AgentOutcome & { sessionId: string | null };

/**
 * Environment for the `claude` process. Model calls go through AI Gateway,
 * which holds the provider credentials (unified billing or a stored key) and
 * authenticates the Cloudflare token in `cf-aig-authorization`. Claude Code
 * insists on an `ANTHROPIC_API_KEY`; the gateway ignores it, so it is the
 * same token. `cf-aig-metadata` tags every request in the gateway's logs with
 * the host, branch and session it was made for.
 */
export function agentEnv(job: BuilderJob, p: Paths): NodeJS.ProcessEnv {
  const { accountId, aiGateway, apiToken } = job.cloudflare;
  if (!accountId || !aiGateway) {
    throw new JobError("The coding agent needs an AI Gateway: the job names none.");
  }
  const headers = [
    `cf-aig-authorization: Bearer ${apiToken}`,
    `cf-aig-metadata: ${JSON.stringify(gatewayMetadata(job))}`,
  ];
  return {
    CLAUDE_CONFIG_DIR: p.claudeConfig,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ANTHROPIC_BASE_URL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${aiGateway}/anthropic`,
    ANTHROPIC_API_KEY: apiToken,
    // A Playwright run takes longer than the default two-minute command timeout.
    BASH_DEFAULT_TIMEOUT_MS: "600000",
    BASH_MAX_TIMEOUT_MS: "1200000",
    // One "Name: value" per line.
    ANTHROPIC_CUSTOM_HEADERS: headers.join("\n"),
  };
}

/** What a gateway log entry says about the request: which agent, the app host, the branch and the session. */
export function gatewayMetadata(job: BuilderJob): Record<string, string> {
  let host = job.cloudflare.appOrigin;
  try {
    host = new URL(job.cloudflare.appOrigin).host;
  } catch {
    // Not a URL; the raw value is still a usable tag.
  }
  return { agent: "builder", host, branch: job.branch.name, sessionId: job.sessionId };
}

export function agentArgs(turn: AgentTurn, p: Paths): string[] {
  const args = [
    "-p",
    turn.prompt,
    "--bare",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    ALLOWED_TOOLS,
    "--append-system-prompt-file",
    promptPath(p.prompts, "system"),
    "--json-schema",
    JSON.stringify(OUTCOME_SCHEMA),
  ];
  if (turn.resumeSessionId) args.push("--resume", turn.resumeSessionId);
  return args;
}

/**
 * Runs one headless Claude Code turn in the repository and returns its
 * structured outcome. `--output-format stream-json` prints one JSON line per
 * step as it happens; each noteworthy one becomes a progress event, and the
 * last line is the result.
 */
export async function runAgentTurn(
  job: BuilderJob,
  p: Paths,
  turn: AgentTurn,
  events: EventLog,
): Promise<AgentTurnResult> {
  const env = agentEnv(job, p);
  events.progress(
    turn.resumeSessionId ? "agent turn started (resuming session)" : "agent turn started",
  );
  const started = Date.now();
  const result = await run("claude", agentArgs(turn, p), {
    cwd: p.repo,
    env,
    timeoutMs: AGENT_TURN_TIMEOUT_MS,
    onLine: (line) => {
      for (const text of describeAgentLine(line)) events.progress(text);
    },
  });
  const seconds = Math.round((Date.now() - started) / 1000);

  if (result.timedOut) {
    throw new JobError(
      `The coding agent did not finish within ${AGENT_TURN_TIMEOUT_MS / 60000} minutes.`,
      tail(combined(result)),
    );
  }

  const parsed = parseAgentOutput(result.stdout);
  if (!parsed) {
    throw new JobError(
      result.code === 0
        ? "The coding agent returned no structured result."
        : `The coding agent exited with code ${result.code}.`,
      tail(combined(result)),
    );
  }
  if (parsed.isError && !parsed.outcome) {
    throw new JobError(
      `The coding agent failed: ${parsed.errorText ?? "unknown error"}`,
      tail(combined(result)),
    );
  }
  if (!parsed.outcome) {
    throw new JobError(
      "The coding agent ended without reporting an outcome.",
      tail(combined(result)),
    );
  }
  events.progress(`agent turn finished in ${seconds}s: ${parsed.outcome.status}`);
  return { ...parsed.outcome, sessionId: parsed.sessionId };
}

export type ParsedAgentOutput = {
  sessionId: string | null;
  outcome: AgentOutcome | null;
  isError: boolean;
  errorText?: string;
};

const CLIP_CHARS = 240;

/** One line, whitespace collapsed, cut to a readable length. */
export function clip(text: string, max = CLIP_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The progress lines for one stream-json line from the agent: what it is
 * thinking, what it says, and each tool it uses, as they happen. Lines that
 * carry nothing worth showing (init, tool results that succeeded) give none.
 */
export function describeAgentLine(line: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(value) || !isRecord(value.message)) return [];
  const content = value.message.content;
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (value.type === "assistant") {
      if (block.type === "thinking" && typeof block.thinking === "string") {
        if (block.thinking.trim()) out.push(`thinking: ${clip(block.thinking)}`);
      } else if (block.type === "text" && typeof block.text === "string") {
        if (block.text.trim()) out.push(`agent: ${clip(block.text)}`);
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        out.push(describeTool(block.name, block.input));
      }
    } else if (
      value.type === "user" &&
      block.type === "tool_result" &&
      block.is_error === true
    ) {
      out.push(`tool failed: ${clip(toolResultText(block.content))}`);
    }
  }
  return out;
}

function describeTool(name: string, input: unknown): string {
  const args = isRecord(input) ? input : {};
  const str = (key: string) =>
    typeof args[key] === "string" ? (args[key] as string) : "";
  switch (name) {
    case "Read":
      return `reading ${str("file_path")}`;
    case "Edit":
    case "MultiEdit":
    case "Write":
      return `editing ${str("file_path")}`;
    case "Bash":
      return `running: ${clip(str("command"), 160)}`;
    case "Grep":
    case "Glob":
      return `searching for ${clip(str("pattern"), 80)}`;
    case "Agent":
    case "Task":
      return `delegating: ${clip(str("description") || str("prompt"), 120)}`;
    default:
      return `using ${name}`;
  }
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .join(" ");
  return "";
}

/**
 * `claude -p --output-format stream-json` ends with one JSON object (the final result)
 * with `session_id`, `is_error`, `result` and, with --json-schema,
 * `structured_output`. Older or odd outputs may wrap it in an array or put the
 * JSON inside `result`; both are handled.
 */
export function parseAgentOutput(stdout: string): ParsedAgentOutput | null {
  const text = stdout.trim();
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // Some runs print warnings before the JSON; take the last line that parses.
    const lines = text.split("\n").reverse();
    for (const line of lines) {
      try {
        value = JSON.parse(line);
        break;
      } catch {
        // keep looking
      }
    }
  }
  if (value === undefined) return null;
  const record = Array.isArray(value)
    ? [...(value as unknown[])]
        .reverse()
        .find(
          (item): item is Record<string, unknown> =>
            isRecord(item) && item.type === "result",
        )
    : isRecord(value)
      ? value
      : undefined;
  if (!record) return null;

  const sessionId = typeof record.session_id === "string" ? record.session_id : null;
  const isError =
    record.is_error === true ||
    (typeof record.subtype === "string" && record.subtype.startsWith("error"));
  let outcome = toOutcome(record.structured_output);
  if (!outcome && typeof record.result === "string") {
    try {
      outcome = toOutcome(JSON.parse(record.result));
    } catch {
      // plain text result; no outcome
    }
  }
  const errorText =
    typeof record.result === "string" && !outcome
      ? record.result
      : Array.isArray(record.errors)
        ? record.errors.map(String).join("; ")
        : undefined;
  return { sessionId, outcome, isError, errorText };
}

function toOutcome(value: unknown): AgentOutcome | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  if (status !== "done" && status !== "question" && status !== "blocked") return null;
  return {
    status,
    summary: typeof value.summary === "string" ? value.summary : "",
    reasoning: typeof value.reasoning === "string" ? value.reasoning : "",
    message: typeof value.message === "string" ? value.message : "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
