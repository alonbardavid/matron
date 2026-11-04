/** Semantic colour tokens on top of the Mantine theme, as CSS values that follow the colour scheme. */
export const palette = {
  /** The branch warning strip. */
  warning: "var(--mantine-color-yellow-light)",
  warningText: "var(--mantine-color-yellow-light-color)",
  /** The signed-in user's own chat messages: a light blue bubble. */
  bubbleUser: "var(--matron-chat-user-bg)",
  bubbleUserText: "var(--matron-on-chat-user)",
  /** Assistant, planner and builder messages: a white card. */
  bubbleAgent: "var(--matron-chat-assistant-bg)",
  /** The "connected" dot. */
  connected: "var(--matron-success-dot)",
} as const;

const STATUS_COLORS: Record<string, string> = {
  deploying: "yellow",
  ready: "sage",
  merging: "blue",
  planning: "gray",
  building: "blue",
  waiting: "yellow",
  deployed: "sage",
  failed: "red",
  closed: "gray",
  merged: "sage",
  abandoned: "gray",
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "gray";
}
