/** Semantic colour tokens on top of the Mantine theme, as CSS values that follow the colour scheme. */
export const palette = {
  /** Background of the signed-in user's own chat messages. */
  bubbleUser: "var(--mantine-primary-color-light)",
  /** Background of planner and builder chat messages. */
  bubbleAgent: "var(--mantine-color-default)",
  /** The branch warning strip. */
  warning: "var(--mantine-color-yellow-light)",
  warningText: "var(--mantine-color-yellow-light-color)",
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
