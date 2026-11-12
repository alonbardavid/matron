import type { AgentOutcome, AgentPrompt, BuilderFile, BuilderRun } from "./protocol";

/** Where a run is in its sequence of turns. */
export type Phase =
  | "prepare"
  | "install"
  | "agent"
  | "verify"
  | "commit-push"
  | "deploy-preview"
  | "deploy-production"
  | "cleanup"
  | "restore-database"
  | "deploy-revert";

/**
 * One run's checkpoint: the run, where it is, and what it has learned so
 * far. Stashed into the run's fiber before every phase, so an evicted object
 * picks the run up from here; kept in the builder's state while the run is
 * parked on a question.
 */
export interface Checkpoint {
  run: BuilderRun;
  /**
   * The session's id for this run, which names its record and lines. With
   * the turn number it is each turn's operation id, so a recovered fiber
   * that submits a turn again gets the operation already under way, while a
   * later run on the session never meets an earlier run's results.
   */
  runId: string;
  phase: Phase;
  /** Numbers the turns. */
  turn: number;
  /** What the next agent turn is asked. */
  prompt: AgentPrompt | null;
  /** The agent's description of the change, kept across fix rounds. */
  outcome: AgentOutcome | null;
  fixRound: number;
  /** What prepare-continue said about main, for the agent's prompt. */
  sync: string | null;
  /** Main's head after a merge or a revert, for the report. */
  mergedHead: string | null;
}

export function checkpointFor(run: BuilderRun, runId: string): Checkpoint {
  return {
    run,
    runId,
    phase: "prepare",
    turn: 0,
    prompt: null,
    outcome: null,
    fixRound: 0,
    sync: null,
    mergedHead: null,
  };
}

/** A user message that arrived while a turn ran, with what came with it. */
export interface PendingMessage {
  text: string;
  files: BuilderFile[];
}

/** Pending messages as one prompt: the texts joined, every file that came along. */
export interface Pending {
  message: string;
  files?: BuilderFile[];
}

export function joinPending(messages: PendingMessage[]): Pending {
  const message = messages
    .map((item) => item.text)
    .filter((text) => text.trim())
    .join("\n\n");
  const files = messages.flatMap((item) => item.files);
  return files.length ? { message, files } : { message };
}

/** The builder's own state, in its storage: what runs, what waits, what the user said meanwhile. */
export interface BuilderState {
  /** A fiber is executing a run. */
  active: boolean;
  /** A run parked on a question, until the user replies. */
  waiting: Checkpoint | null;
  /** The run that is active or parked. */
  currentRunId: string | null;
  /** User messages that arrived while a turn ran; the next agent turn gets them. */
  pending: PendingMessage[];
  /** When the user last spoke; the silence limit counts from here. */
  lastUserMessageAt: number | null;
  /** The silence limit hit while a run was active: the run parks instead of failing. */
  timedOut: boolean;
  /** The scheduled silence check, replaced on every user message. */
  watchdogId: string | null;
}

export const EMPTY_STATE: BuilderState = {
  active: false,
  waiting: null,
  currentRunId: null,
  pending: [],
  lastUserMessageAt: null,
  timedOut: false,
  watchdogId: null,
};

/** What became of a user message handed to the builder. */
export type ContinueOutcome =
  /** A parked run picked the work up with it. */
  | "resumed"
  /** A run is active; its next agent turn reads it. */
  | "queued"
  /** Nothing runs or waits: the session has to start a run for it. */
  | "idle";
