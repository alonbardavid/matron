import {
  Agent,
  type AgentToolRunInspection,
  type AgentToolStoredChunk,
  type FiberContext,
  type FiberRecoveryContext,
} from "agents";
import type { ContainerHarness } from "agents/harness/container";
import {
  markReady,
  markReverted,
  markRevertFailed,
  revertPoint,
} from "@backend/arch-branches/service";
import {
  restoreProductionDatabase,
  storageSnapshotStore,
} from "@backend/arch-time-travel/service";
import { logger } from "@backend/commons/logger";
import type {
  BuilderFile,
  BuilderRun,
  BuilderStatusDetail,
  RevertRun,
  RunMode,
  StepInput,
  StepName,
  TerminalStatus,
} from "./protocol";
import { builderHarness } from "./harness";
import { PHASE_TEXT, replyPrompt, runPhase, type PhaseContext } from "./phases";
import { RunRecords } from "./run-records";
import {
  EMPTY_STATE,
  checkpointFor,
  joinPending,
  type BuilderState,
  type Checkpoint,
  type ContinueOutcome,
  type Pending,
  type PendingMessage,
} from "./state";
import { Turns } from "./turns";

const log = logger("arch-builder/builder-object");

const STATE_KEY = "state";
/**
 * The longest a run goes without a word from the user. Past it the run is
 * halted and parked, the container snapshotted and stopped, and the chat told;
 * the next message picks the work up again.
 */
const USER_SILENCE_LIMIT_MS = 30 * 60_000;
const TIMED_OUT_TEXT =
  "The builder stopped: thirty minutes passed without a message from you. Reply here to pick the work up where it left off, or abandon the branch from the branch menu.";
const NO_CONTAINER_TEXT = "The builder container is not available in this deployment";

/** What a finished run says of itself. */
const SUMMARIES: Record<Exclude<TerminalStatus, "failed">, string> = {
  deployed: "Deployed",
  merged: "Merged into main",
  abandoned: "Branch abandoned",
  reverted: "Reverted",
};

/**
 * The builder of one session: the Durable Object that owns the builder
 * container, named by the session id like the session object. It runs the
 * session's builds, merges, abandons and reverts, one at a time.
 *
 * A run is a fiber: a sequence of container turns, checkpointed before each
 * phase, so an evicted object resumes it from the last checkpoint. A question
 * from the coding agent parks the run until the user replies. Each run is also
 * one of the session's agent-tool runs: the session's run handle asks this
 * object for the run's record and lines, which stream to the chat as the
 * run's chunks. What the builder has to say to the user, and its status, go
 * to the session object directly.
 */
export class BuilderObject extends Agent<Cloudflare.Env> {
  private readonly harness: ContainerHarness | null;
  private readonly turns: Turns | null;
  private readonly records: RunRecords;
  // Events are handled one at a time, in arrival order.
  private chain: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.records = new RunRecords(ctx.storage.sql);
    this.harness = ctx.container ? builderHarness(ctx, ctx.container, env) : null;
    if (this.harness) this.lifecycle.use(this.harness);
    this.turns = this.harness
      ? new Turns(this.harness, (runId, line) =>
          this.records.line(runId, line.text, line.kind),
        )
      : null;
  }

  // ── RPC from the run handle ───────────────────────────────────────────────

  /** The run begins now; its lines are the run's chunks. */
  async startRun(runId: string, run: BuilderRun): Promise<AgentToolRunInspection> {
    return this.serial(async () => {
      const existing = this.records.inspect(runId);
      if (existing) return existing;
      const opened = this.records.open(runId);
      try {
        await this.begin(run, runId);
      } catch (err) {
        this.records.end(runId, "error", messageOf(err));
        throw err;
      }
      return this.records.inspect(runId) ?? opened;
    });
  }

  /** The run's record; null for a run this builder never saw. */
  async inspectRun(runId: string): Promise<AgentToolRunInspection | null> {
    return this.records.inspect(runId);
  }

  /** The run's stored lines after `afterSequence`. */
  async runChunks(runId: string, afterSequence: number): Promise<AgentToolStoredChunk[]> {
    return this.records.chunks(runId, afterSequence);
  }

  /** The run's lines, stored ones first and then live, until the run ends. */
  async tailRun(
    runId: string,
    afterSequence: number,
  ): Promise<ReadableStream<Uint8Array>> {
    return this.records.tail(runId, afterSequence);
  }

  /** The session gave the run up: whatever it was doing is halted, and the run is over. */
  async cancelRun(runId: string, reason: string): Promise<void> {
    await this.serial(async () => {
      if (this.records.isOver(runId)) return;
      const state = await this.load();
      if (state.currentRunId === runId) {
        log.info("run cancelled", { runId, reason, sessionId: this.name });
        state.waiting = null;
        state.currentRunId = null;
        state.pending = [];
        await this.forgetSilenceCheck(state);
        await this.save(state);
        await this.stopHarness(true);
      }
      this.records.end(runId, "aborted", reason || "cancelled");
    });
  }

  // ── RPC from the session and the Troubleshooting page ─────────────────────

  /**
   * A user message for the builder: the reply a parked run waits for, or kept
   * for the next turn of an active one. With nothing running or waiting the
   * session has to start a run, and is told so.
   */
  async continueWith(text: string, files: BuilderFile[]): Promise<ContinueOutcome> {
    return this.serial(async () => {
      const state = await this.load();
      if (state.active) {
        await this.heard(state);
        state.pending.push({ text, files });
        await this.save(state);
        return "queued";
      }
      if (state.waiting) {
        await this.heard(state);
        const at = state.waiting;
        state.waiting = null;
        at.phase = "agent";
        at.prompt = replyPrompt(joinPending([{ text, files }, ...state.pending]));
        state.pending = [];
        await this.session().builderStatus("building");
        await this.launch(state, at);
        return "resumed";
      }
      return "idle";
    });
  }

  async status(): Promise<{
    active: boolean;
    waiting: boolean;
    running: boolean;
    mode: RunMode | null;
  }> {
    const state = await this.load();
    const container = this.harness ? await this.harness.container() : null;
    return {
      active: state.active,
      waiting: state.waiting !== null,
      running: container?.running ?? false,
      mode: state.waiting?.run.mode ?? null,
    };
  }

  /** Stops the container by hand: an active run parks, as when the silence limit hits. */
  async stopContainer(): Promise<void> {
    await this.serial(async () => this.halt(await this.load()));
  }

  /** Cleared with its session: the container, the harness's record, the state and every alarm are dropped. */
  async clear(): Promise<void> {
    await this.serial(async () => {
      await this.stopHarness(true);
      this.records.closeAll();
      log.info("builder cleared", { sessionId: this.name });
      await this.destroy();
    });
  }

  /** The silence check: nothing heard since it was set, so the run is halted. */
  async onSilence(payload: { at: number }): Promise<void> {
    await this.serial(async () => {
      const state = await this.load();
      // A later message restarted the clock.
      if (state.lastUserMessageAt !== payload.at) return;
      state.watchdogId = null;
      await this.halt(state);
    });
  }

  /** An evicted object picks the run up from its last checkpoint. */
  async onFiberRecovered(ctx: FiberRecoveryContext): Promise<void> {
    if (!ctx.name.startsWith("run:") || !ctx.snapshot) return;
    const at = ctx.snapshot as Checkpoint;
    log.info("run recovered", { sessionId: this.name, phase: at.phase });
    void this.runFiber(ctx.name, (fiber) => this.execute(at, fiber));
  }

  // ── The run ───────────────────────────────────────────────────────────────

  private async begin(run: BuilderRun, runId: string): Promise<void> {
    const state = await this.load();
    if (state.active) throw new Error("The builder is already running for this session");
    if (state.waiting) {
      // A merge or an abandon while a build waits for an answer: that build is over.
      this.records.end(state.waiting.runId, "aborted", `superseded by a ${run.mode}`);
      state.waiting = null;
    }
    state.currentRunId = runId;
    await this.heard(state);
    const at = checkpointFor(run, runId);
    if (!this.turns) {
      log.warn("no container in this deployment", {
        sessionId: this.name,
        mode: run.mode,
      });
      await this.save(state);
      await this.finish(at, "failed", { error: NO_CONTAINER_TEXT });
      return;
    }
    if (run.mode === "build" || run.mode === "continue") {
      await this.session().builderStatus("building");
    }
    await this.launch(state, at);
  }

  /** Starts the run's fiber, from the checkpoint; the state says a run is active. */
  private async launch(state: BuilderState, at: Checkpoint): Promise<void> {
    state.active = true;
    await this.save(state);
    log.info("run started", { sessionId: this.name, mode: at.run.mode, phase: at.phase });
    void this.runFiber(`run:${this.name}`, (fiber) => this.execute(at, fiber)).catch(
      (err) => log.error("run fiber failed", { err, sessionId: this.name }),
    );
  }

  /** The fiber: one phase at a time, checkpointed before each, until the run parks or ends. */
  private async execute(at: Checkpoint, fiber: FiberContext): Promise<void> {
    const ctx = this.phaseContext(at);
    try {
      for (;;) {
        fiber.stash(at);
        ctx.progress(at.phase);
        const next = await runPhase(at, ctx);
        if (next === "park") {
          const state = await this.load();
          state.waiting = at;
          state.active = false;
          await this.save(state);
          return;
        }
        if (next === "end") break;
      }
    } catch (err) {
      const state = await this.load();
      if (state.timedOut) {
        await this.timedOut(at, state);
        return;
      }
      log.error("run failed", { err, sessionId: this.name, phase: at.phase });
      const text = messageOf(err);
      await this.session().relay(text);
      await this.finish(at, "failed", { error: firstLine(text) });
    } finally {
      const state = await this.load();
      state.active = false;
      await this.save(state);
    }
  }

  /** What a phase of this run may do: take turns, talk to the session, write its lines, finish. */
  private phaseContext(at: Checkpoint): PhaseContext {
    const turns = this.turns!;
    return {
      step: <T = unknown>(name: StepName, input?: StepInput) =>
        turns.step<T>(at, name, input),
      agentTurn: () => turns.agent(at),
      takePending: (first) => this.takePending(first),
      say: (text) => this.session().relay(text),
      status: (status) => this.session().builderStatus(status),
      line: (line) => this.records.line(at.runId, line.text, line.kind),
      progress: (phase, message = PHASE_TEXT[phase] ?? phase) =>
        this.records.progress(at.runId, phase, message),
      restoreDatabase: () => this.restoreDatabase(at.run.branch.id),
      finish: (status, detail) => this.finish(at, status, detail),
    };
  }

  /** The user messages that arrived meanwhile, after `first`, taken and cleared. */
  private async takePending(first?: PendingMessage): Promise<Pending | null> {
    const state = await this.load();
    const all = [...(first ? [first] : []), ...state.pending];
    if (all.length === 0) return null;
    state.pending = [];
    await this.save(state);
    return joinPending(all);
  }

  /**
   * The run is over: the session is told, the record closed, the container
   * stopped unless a fix may follow. A revert's session is archived, so its
   * outcome goes on the branch row instead.
   */
  private async finish(
    at: Checkpoint,
    status: TerminalStatus,
    detail?: BuilderStatusDetail,
  ): Promise<void> {
    const { run } = at;
    log.info("run finished", { sessionId: this.name, mode: run.mode, status });
    if (status === "failed" && (run.mode === "merge" || run.mode === "abandon")) {
      await markReady(run.branch.id).catch((err) =>
        log.warn("mark ready failed", { err, sessionId: this.name }),
      );
    }
    const state = await this.load();
    state.waiting = null;
    state.currentRunId = null;
    state.pending = [];
    await this.forgetSilenceCheck(state);
    await this.save(state);
    if (run.mode === "revert") {
      await this.recordRevert(
        run,
        status === "reverted" ? null : (detail?.error ?? "failed"),
      );
    } else if (status !== "reverted") {
      await this.session().builderStatus(status, detail);
    }
    if (status === "failed")
      this.records.end(at.runId, "error", detail?.error ?? "failed");
    else this.records.end(at.runId, "completed", SUMMARIES[status]);
    // Nothing more comes for a deployed, merged, abandoned or reverted run: the container
    // goes now, its workspace snapshotted. A failed run is left to the idle
    // stop, like a question: a fix may follow within minutes.
    if (status !== "failed") await this.stopHarness(false);
  }

  // ── The silence limit ─────────────────────────────────────────────────────

  /** A user message arrived: the silence clock restarts. The caller saves the state. */
  private async heard(state: BuilderState): Promise<void> {
    await this.forgetSilenceCheck(state);
    const at = Date.now();
    state.lastUserMessageAt = at;
    state.timedOut = false;
    const check = await this.schedule(USER_SILENCE_LIMIT_MS / 1000, "onSilence", { at });
    state.watchdogId = check.id;
  }

  private async forgetSilenceCheck(state: BuilderState): Promise<void> {
    if (!state.watchdogId) return;
    await this.cancelSchedule(state.watchdogId).catch(() => false);
    state.watchdogId = null;
  }

  /**
   * Halts whatever runs and puts the container away, its workspace
   * snapshotted. An active run is aborted and marked timed out, so its fiber
   * parks it instead of failing it.
   */
  private async halt(state: BuilderState): Promise<void> {
    if (!this.harness) return;
    if (state.active) {
      state.timedOut = true;
      await this.save(state);
    }
    await this.stopHarness(state.active);
    log.info("builder halted", { sessionId: this.name, active: state.active });
  }

  /**
   * The silence limit hit mid-run. A build parks, to resume on the next
   * message; a merge, an abandon or a revert cannot resume, so it fails.
   */
  private async timedOut(at: Checkpoint, state: BuilderState): Promise<void> {
    const { run } = at;
    state.timedOut = false;
    log.info("run timed out", { sessionId: this.name, mode: run.mode, phase: at.phase });
    if (run.mode === "merge" || run.mode === "abandon" || run.mode === "revert") {
      await this.save(state);
      await this.session().relay(
        `The ${run.mode} stopped: thirty minutes passed without a message. Start it again from ${run.mode === "revert" ? "the troubleshooting page" : "the branch menu"}.`,
      );
      await this.finish(at, "failed", { error: "timed out" });
      return;
    }
    state.waiting = at;
    await this.save(state);
    await this.session().relay(TIMED_OUT_TEXT);
    await this.session().builderStatus("timed_out");
    this.records.progress(at.runId, "stopped", "stopped until your next message");
  }

  /**
   * Restores the production database to when the branch was created. That
   * moment is kept beside the router tables' snapshot: a restore cut short
   * may leave the database without the branch's row until it is run again.
   */
  private async restoreDatabase(branchId: string): Promise<number> {
    const key = `revert:${branchId}`;
    let to = await this.ctx.storage.get<number>(`${key}:to`);
    if (to === undefined) {
      to = await revertPoint(branchId);
      await this.ctx.storage.put(`${key}:to`, to);
    }
    await restoreProductionDatabase(to, storageSnapshotStore(this.ctx.storage, key));
    await this.ctx.storage.delete(`${key}:to`);
    return to;
  }

  /** A revert's outcome on its branch row: reverted, or failed with `error`. */
  private async recordRevert(run: RevertRun, error: string | null): Promise<void> {
    try {
      if (error === null) await markReverted(run.branch.id);
      else await markRevertFailed(run.branch.id, error);
    } catch (err) {
      log.error("revert outcome not recorded", { err, sessionId: this.name });
    }
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  /** Stops the container, after aborting the turn under way when asked; the workspace is snapshotted. */
  private async stopHarness(abort: boolean): Promise<void> {
    if (!this.harness) return;
    if (abort) await this.harness.abort().catch(() => false);
    await this.harness
      .stop()
      .catch((err) => log.warn("container stop failed", { err, sessionId: this.name }));
  }

  /** Runs `task` after every earlier event has finished. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.then(
      () => undefined,
      (err) => log.error("builder event failed", { err }),
    );
    return next;
  }

  private session() {
    return this.env.BUILD_SESSIONS.getByName(this.name);
  }

  private async load(): Promise<BuilderState> {
    const stored = await this.ctx.storage.get<BuilderState>(STATE_KEY);
    return { ...EMPTY_STATE, ...stored, pending: stored?.pending ?? [] };
  }

  private async save(state: BuilderState): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
  }
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() || "failed";
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
