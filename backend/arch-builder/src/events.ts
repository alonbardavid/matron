import type { BuildSessionStatus } from "@backend/db-models/arch-sessions";
import {
  TERMINAL_STATUSES,
  type BuilderStatus,
  type StepLine,
  type TerminalStatus,
} from "./protocol";

/** Builder statuses the session is told about; the others are internal. */
export const RELAYED_STATUSES = [
  "building",
  "waiting",
  "deploying",
  "deployed",
  "failed",
  "timed_out",
  "merged",
  "abandoned",
] as const;
export type RelayedStatus = (typeof RELAYED_STATUSES)[number];

export function isRelayedStatus(status: BuilderStatus): status is RelayedStatus {
  return (RELAYED_STATUSES as readonly string[]).includes(status);
}

export function isTerminalStatus(status: BuilderStatus): status is TerminalStatus {
  return TERMINAL_STATUSES.has(status);
}

/** The session row's status for a status the builder reported. */
export function sessionStatusFor(status: RelayedStatus): BuildSessionStatus {
  switch (status) {
    case "building":
    case "deploying":
      return "building";
    case "waiting":
      return "waiting";
    case "deployed":
      return "deployed";
    case "failed":
      return "failed";
    case "timed_out":
      return "timed_out";
    case "merged":
      return "merged";
    case "abandoned":
      return "abandoned";
  }
}

/** A step line as the daemon relayed it in a `raw` event, or null for anything else. */
export function asStepLine(value: unknown): StepLine | null {
  if (typeof value !== "object" || value === null) return null;
  const line = value as Partial<StepLine>;
  switch (line.type) {
    case "progress":
    case "log":
      return typeof line.text === "string" ? (line as StepLine) : null;
    case "result":
      return line as StepLine;
    case "error":
      return typeof line.message === "string" ? (line as StepLine) : null;
    default:
      return null;
  }
}
