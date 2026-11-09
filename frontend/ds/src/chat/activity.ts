import { getToolName, isToolUIPart, type UIMessage } from "ai";

/**
 * What the agent is doing right now, as a status for the thinking indicator:
 * the label of the tool call still running at the end of its reply in the
 * making, or nothing when it is between calls or composing its answer. Tool
 * calls are the agent's own business; once the reply is there they are not
 * shown.
 */
export function currentActivity(
  messages: UIMessage[],
  labels: Record<string, string>,
): string | undefined {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return undefined;
  const part = last.parts[last.parts.length - 1];
  if (!part || !isToolUIPart(part)) return undefined;
  if (part.state === "output-available" || part.state === "output-error")
    return undefined;
  const name = getToolName(part);
  return labels[name] ?? "working";
}
