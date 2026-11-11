import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  claudeCodeCli,
  cliAdapter,
  serveFromEnv,
  type CliCommand,
  type CliParser,
  type CliTurn,
} from "agents/harness/container/runtime";
import { agentArgv, renderPrompt } from "./agent-prompt.js";
import { paths } from "./state.js";
import type { BuilderFile, StepLine, TurnRequest } from "./types.js";

/**
 * The image's entrypoint: the container harness's daemon, with an adapter
 * that runs two kinds of turns. The prompt of every turn is a JSON
 * {@link TurnRequest}: a `step` runs `node /app/dist/cli.js <step>` with the
 * request on its stdin and reports the step's result line as the outcome; an
 * `agent` turn runs the coding agent in the checkout, the way the harness's
 * own Claude Code preset does, and reports its structured output as the
 * outcome.
 */
const p = paths();

function parseRequest(prompt: string): TurnRequest {
  const request = JSON.parse(prompt) as Partial<TurnRequest>;
  if (request.kind !== "step" && request.kind !== "agent") {
    throw new Error(`not a turn request: ${prompt.slice(0, 80)}`);
  }
  return request as TurnRequest;
}

function stepCommand(request: Extract<TurnRequest, { kind: "step" }>): CliCommand {
  return {
    argv: ["node", "/app/dist/cli.js", request.step],
    stdin: JSON.stringify(request),
    env: { MATRON_WORK_DIR: p.work },
  };
}

function agentCommand(
  request: Extract<TurnRequest, { kind: "agent" }>,
  turn: CliTurn,
): CliCommand {
  const sessionId = turn.state.sessionId;
  const files = request.prompt.kind === "fix" ? [] : (request.prompt.files ?? []);
  return {
    argv: agentArgv(p.repo, p.prompts, request.model, sessionId),
    stdin: renderPrompt(
      request.run,
      request.prompt,
      p.prompts,
      !!sessionId,
      writeAttachments(files),
    ),
    env: {
      CLAUDE_CONFIG_DIR: p.claudeConfig,
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      // A Playwright run takes longer than the default two-minute command timeout.
      BASH_DEFAULT_TIMEOUT_MS: "600000",
      BASH_MAX_TIMEOUT_MS: "1200000",
    },
  };
}

/**
 * Writes the files that came with the user's message where the agent can
 * read them: a directory of their own under the attachments folder, outside the checkout,
 * so nothing of them is ever committed. Returns their paths.
 */
function writeAttachments(files: BuilderFile[]): string[] {
  if (files.length === 0) return [];
  const dir = join(p.attachments, String(Date.now()));
  mkdirSync(dir, { recursive: true });
  return files.map((file, index) => {
    const name = basename(file.name).replace(/[^A-Za-z0-9._-]+/g, "_") || `file-${index}`;
    const path = join(dir, `${index + 1}-${name}`);
    writeFileSync(path, Buffer.from(file.data, "base64"));
    return path;
  });
}

/** A step's lines become `raw` events; its last line is the outcome. */
function stepParser(): CliParser {
  return {
    line(text) {
      const line = parseStepLine(text);
      if (!line) return { events: [{ type: "raw", value: { type: "log", text } }] };
      if (line.type === "result") {
        return { outcome: { status: "done", text: JSON.stringify(line.data ?? {}) } };
      }
      if (line.type === "error") {
        const reason = line.output
          ? `${line.message}\n\n\`\`\`\n${line.output}\n\`\`\``
          : line.message;
        return { outcome: { status: "unanswered", reason } };
      }
      return { events: [{ type: "raw", value: line }] };
    },
    end({ code, stderr }) {
      return {
        status: "unanswered",
        reason: `the step exited with ${code ?? "a signal"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
      };
    },
  };
}

/**
 * The preset's parser, with the structured output as the outcome: the
 * result line's `structured_output` is what the object needs, not the
 * model's closing words.
 */
function agentParser(turn: CliTurn): CliParser {
  const inner = claudeCodeCli.parser(turn);
  return {
    line(text) {
      const update = inner.line(text);
      if (update.outcome?.status !== "done") return update;
      const structured = structuredOutput(text);
      return structured === undefined
        ? update
        : { ...update, outcome: { status: "done", text: JSON.stringify(structured) } };
    },
    end: inner.end,
  };
}

function structuredOutput(text: string): unknown {
  try {
    const value = JSON.parse(text) as { type?: unknown; structured_output?: unknown };
    return value.type === "result" ? value.structured_output : undefined;
  } catch {
    return undefined;
  }
}

function parseStepLine(text: string): StepLine | null {
  if (!text.startsWith("{")) return null;
  try {
    const value = JSON.parse(text) as Partial<StepLine>;
    switch (value.type) {
      case "progress":
      case "log":
        return typeof value.text === "string" ? (value as StepLine) : null;
      case "result":
        return value as StepLine;
      case "error":
        return typeof value.message === "string" ? (value as StepLine) : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

const version = (() => {
  try {
    return (JSON.parse(readFileSync("/app/package.json", "utf8")) as { version?: string })
      .version;
  } catch {
    return undefined;
  }
})();

await serveFromEnv(
  cliAdapter({
    id: "matron",
    ...(version ? { version } : {}),
    stateDirs: claudeCodeCli.stateDirs,
    cwd: p.work,
    command(turn) {
      const request = parseRequest(turn.prompt);
      return request.kind === "step" ? stepCommand(request) : agentCommand(request, turn);
    },
    parser(turn) {
      return parseRequest(turn.prompt).kind === "step" ? stepParser() : agentParser(turn);
    },
  }),
);
