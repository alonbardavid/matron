import type Anthropic from "@anthropic-ai/sdk";

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * The Messages API takes the system prompt apart and wants user/assistant
 * turns starting with user; same-role neighbours are merged.
 */
export function toTurns(messages: ModelMessage[]): {
  system: string;
  turns: Anthropic.Beta.BetaMessageParam[];
} {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const last = turns[turns.length - 1];
    if (last && last.role === message.role) last.content += `\n\n${message.content}`;
    else turns.push({ role: message.role, content: message.content });
  }
  if (turns.length === 0 || turns[0]?.role === "assistant") {
    turns.unshift({ role: "user", content: "(start)" });
  }
  return { system, turns };
}
