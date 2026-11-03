import type { BuildSessionStatus } from "@backend/db-models/arch-sessions";
import {
  TERMINAL_STATUSES,
  type BuilderEvent,
  type BuilderMode,
  type BuilderStatus,
  type BuilderStatusDetail,
  type TerminalStatus,
} from "./protocol";

/** Builder statuses the session is told about; the others are container-internal. */
export const RELAYED_STATUSES = [
  "building",
  "waiting",
  "deploying",
  "deployed",
  "failed",
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
    case "merged":
      return "merged";
    case "abandoned":
      return "abandoned";
  }
}

/** Whether a container that stopped in `status` is worth keeping as a snapshot. */
export function keepsSnapshot(mode: BuilderMode, status: BuilderStatus): boolean {
  return (
    (mode === "build" || mode === "continue") &&
    status !== "merged" &&
    status !== "abandoned"
  );
}

export interface ReducedEvents {
  lastSeq: number;
  messages: string[];
  progress: string[];
  logs: string[];
  statuses: { status: BuilderStatus; detail?: BuilderStatusDetail }[];
  /** The last terminal status in the batch, if any. */
  terminal: { status: TerminalStatus; detail?: BuilderStatusDetail } | null;
}

/** Orders a batch of events, drops any already seen, and sorts them by kind. */
export function reduceEvents(events: BuilderEvent[], lastSeq: number): ReducedEvents {
  const fresh = events
    .filter((event) => event.seq > lastSeq)
    .sort((a, b) => a.seq - b.seq);
  const out: ReducedEvents = {
    lastSeq,
    messages: [],
    progress: [],
    logs: [],
    statuses: [],
    terminal: null,
  };
  for (const event of fresh) {
    out.lastSeq = event.seq;
    if (event.type === "message") out.messages.push(event.text);
    else if (event.type === "progress") out.progress.push(event.text);
    else if (event.type === "log") out.logs.push(event.text);
    else {
      out.statuses.push({ status: event.status, detail: event.detail });
      if (isTerminalStatus(event.status))
        out.terminal = { status: event.status, detail: event.detail };
    }
  }
  return out;
}

/** The spec's five-minute rule: a builder left waiting this long is snapshotted and stopped. */
export const WAITING_GRACE_MS = 5 * 60_000;

export function waitedTooLong(
  waitingSince: number | null,
  now: number,
  graceMs = WAITING_GRACE_MS,
): boolean {
  return waitingSince !== null && now - waitingSince >= graceMs;
}
