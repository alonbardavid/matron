import type { ContainerMessage, ContainerSessionEvent } from "agents/harness/container";
import type { BuildLine } from "@shared/contract/arch/sessions";
import { asStepLine } from "./events";

export type Line = { text: string; kind: BuildLine["kind"] };

const CLIP_CHARS = 240;
const LOG_TAIL = 40;

/**
 * Turns a turn's events into lines: a step's progress and log lines, and
 * what the coding agent thinks, says and does, as each part of its messages
 * first appears. Made per turn, with the messages the container already had,
 * so nothing is described twice.
 */
export class EventRelay {
  /** Parts already described, per message id. */
  private readonly described = new Map<string, number>();
  private readonly failedTools = new Set<string>();

  constructor(
    private readonly emit: (line: Line) => void,
    snapshot: readonly ContainerMessage[],
  ) {
    for (const message of snapshot) this.described.set(message.id, message.parts.length);
  }

  handle(events: readonly ContainerSessionEvent[]): void {
    const logs: string[] = [];
    const lines: Line[] = [];
    for (const event of events) {
      if (event.type === "raw") {
        const line = asStepLine(event.value);
        if (!line) continue;
        if (line.type === "progress") lines.push({ text: line.text, kind: "step" });
        else if (line.type === "log") logs.push(line.text);
      } else if (event.type === "log") {
        logs.push(event.message);
      } else if (event.type === "message") {
        lines.push(...this.describe(event.message));
      }
    }
    if (logs.length) this.emit({ text: logs.slice(-LOG_TAIL).join("\n"), kind: "log" });
    for (const line of lines) this.emit(line);
  }

  private describe(message: ContainerMessage): Line[] {
    if (message.role !== "assistant") return [];
    const seen = this.described.get(message.id) ?? 0;
    const out: Line[] = [];
    message.parts.forEach((part, index) => {
      if (
        part.type === "tool" &&
        part.state === "error" &&
        !this.failedTools.has(part.toolCallId)
      ) {
        this.failedTools.add(part.toolCallId);
        out.push({
          text: `tool failed: ${clip(toolOutputText(part.output))}`,
          kind: "tool",
        });
      }
      if (index < seen) return;
      if (part.type === "text" && part.text.trim())
        out.push({ text: clip(part.text), kind: "agent" });
      else if (part.type === "reasoning" && part.text.trim())
        out.push({ text: clip(part.text), kind: "thought" });
      else if (part.type === "tool")
        out.push({ text: describeTool(part.toolName, part.input), kind: "tool" });
    });
    this.described.set(message.id, Math.max(seen, message.parts.length));
    return out;
  }
}

/** One line, whitespace collapsed, cut to a readable length. */
function clip(text: string, max = CLIP_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
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

function toolOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output))
    return output
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .join(" ");
  return output === undefined ? "" : JSON.stringify(output);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
