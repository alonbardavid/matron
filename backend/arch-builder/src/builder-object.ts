import { Agent, type FiberContext, type FiberRecoveryContext } from "agents";
import {
  ContainerHarness,
  containerAgent,
  type ContainerMessage,
  type ContainerOperationResult,
  type ContainerSessionEvent,
} from "agents/harness/container";
import { markReady } from "@backend/arch-branches/service";
import { logger } from "@backend/commons/logger";
import { getBuilderModel } from "@backend/arch-settings/service";
import { AI_GATEWAY } from "@backend/commons/names";
import type {
  AbandonJob,
  AgentOutcome,
  AgentPrompt,
  BuildJob,
  BuilderJob,
  BuilderMode,
  BuilderStatusDetail,
  CommitPushResult,
  DeployResult,
  MergeJob,
  MergeMainResult,
  PrepareBuildResult,
  PrepareContinueResult,
  StepInput,
  StepName,
  TurnRequest,
  VerifyResult,
} from "./protocol";
import { asStepLine } from "./events";
import { continueJob } from "./jobs";

const log = logger("arch-builder/builder-object");

/** The image name in the generated config's `containers[].images` (scripts/lib/wrangler-config.mjs). */
const BUILDER_IMAGE_NAME = "builder";
// Two vCPUs: install, the builds and the tests are CPU-bound.
const BUILDER_INSTANCE = "standard-3";
const MAX_FIX_ROUNDS = 3;
const STEP_TIMEOUT_MS = 30 * 60_000;
const AGENT_TURN_TIMEOUT_MS = 40 * 60_000;
/**
 * The spec's five-minute rule, as the harness's idle timeout: a job parked
 * on a question runs nothing, and the container is snapshotted and stopped
 * once it has idled this long. The next turn restores it.
 */
const WAITING_GRACE_MS = 5 * 60_000;
/**
 * The longest a job runs without a word from the user. Past it the run is
 * halted and parked, the container snapshotted and stopped, and the chat told;
 * the next message picks the work up again.
 */
const USER_SILENCE_LIMIT_MS = 30 * 60_000;
const TIMED_OUT_TEXT =
  "The builder stopped: thirty minutes passed without a message from you. Reply here to pick the work up where it left off, or abandon the branch from the branch menu.";
/** The host the coding agent calls for its model; the harness adds the gateway and credentials outside the container. */
const MODEL_HOST = "anthropic.harness.internal";
const PLACEHOLDER_KEY = "cf-aig-placeholder";
const STATE_KEY = "state";
const WORK_DIR = "/work";

type Phase =
  | "prepare"
  | "install"
  | "agent"
  | "verify"
  | "commit-push"
  | "deploy-preview"
  | "deploy-production"
  | "cleanup";

/** One job's progress; checkpointed into the fiber, parked while waiting for the user. */
interface JobRun {
  job: BuilderJob;
  phase: Phase;
  /**
   * Tells this run's operations from an earlier job's on the same session: the
   * harness answers a repeated operation id with the earlier result.
   */
  runId: string;
  /** Numbers the turns; with the run id it is each turn's operation id. */
  turn: number;
  /** What the next agent turn is asked. */
  prompt: AgentPrompt | null;
  /** The agent's description of the change, kept across fix rounds. */
  outcome: AgentOutcome | null;
  fixRound: number;
  /** What prepare-continue said about main, or prepare-build about the upstream merge, for the agent's prompt. */
  sync: string | null;
  /** Main's head after a merge, for the merged report. */
  mergedHead: string | null;
}

interface BuilderState {
  sessionId: string | null;
  /** A fiber is executing a run. */
  active: boolean;
  /** A run parked on a question, until the user replies. */
  waiting: JobRun | null;
  /** User messages that arrived while a turn ran; the next agent turn gets them. */
  pending: string[];
  /** When the first job began. */
  createdAt: number | null;
  /** When the user last spoke; the silence limit counts from here. */
  lastUserMessageAt: number | null;
  /** The silence limit hit while a run was active: the run parks instead of failing. */
  timedOut: boolean;
  /** The scheduled silence check, replaced on every user message. */
  watchdogId: string | null;
}

const EMPTY_STATE: BuilderState = {
  sessionId: null,
  active: false,
  waiting: null,
  pending: [],
  createdAt: null,
  lastUserMessageAt: null,
  timedOut: false,
  watchdogId: null,
};

/** Where a run goes next: on with the next phase, parked, or finished. */
type Next = "continue" | "park" | "end";

/**
 * Drives the builder container for one session. An Agent whose container
 * harness (Agents SDK) owns the container: it starts it from the builder
 * image, runs every turn the object submits as a durable operation, relays
 * the turn's events, reattaches after an eviction, and snapshots the
 * workspace when the container idles. A job is a fiber: a sequence of turns,
 * steps and agent turns, checkpointed after each, so an evicted object
 * resumes the job from its last checkpoint. A question from the agent parks
 * the job until the user replies. Named by the session id, like the session
 * object.
 */
export class BuilderObject extends Agent<Cloudflare.Env> {
  private readonly harness: ContainerHarness | null;
  // Events are handled one at a time, in arrival order.
  private chain: Promise<void> = Promise.resolve();
  // Relayed events keep their order on the way to the session.
  private relaying: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    const container = ctx.container;
    this.harness = container ? this.createHarness(container) : null;
    if (this.harness) this.lifecycle.use(this.harness);
  }

  private createHarness(container: Container): ContainerHarness {
    const env = this.env;
    const token = env.CLOUDFLARE_API_TOKEN ?? "";
    const gateway = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID ?? ""}/${AI_GATEWAY}/anthropic`;
    // What a gateway log entry says about the request.
    const metadata = {
      agent: "builder",
      host: hostOf(env.APP_ORIGIN),
      sessionId: this.ctx.id.name ?? "",
    };
    return new ContainerHarness({
      container,
      egress: this.ctx.exports.ContainerEgress,
      instance: BUILDER_INSTANCE,
      idleTimeoutMs: WAITING_GRACE_MS,
      agent: containerAgent({
        image: container.images[BUILDER_IMAGE_NAME] as string,
        adapter: "matron",
        env: {
          ANTHROPIC_BASE_URL: `http://${MODEL_HOST}`,
          ANTHROPIC_API_KEY: PLACEHOLDER_KEY,
          MATRON_WORK_DIR: WORK_DIR,
          // The install step starts the dev servers; test runs reuse them.
          MATRON_WARM_SERVERS: "1",
        },
        egress: [
          {
            host: MODEL_HOST,
            upstream: gateway,
            headers: {
              "cf-aig-authorization": `Bearer ${token}`,
              "x-api-key": token,
              "cf-aig-metadata": JSON.stringify(metadata),
            },
            strip: ["x-api-key", "authorization"],
          },
        ],
      }),
    });
  }

  // ── RPC ───────────────────────────────────────────────────────────────────

  async startBuild(job: BuildJob): Promise<void> {
    await this.serial(() => this.begin(job));
  }

  async startMerge(job: MergeJob): Promise<void> {
    await this.serial(() => this.begin(job));
  }

  async startAbandon(job: AbandonJob): Promise<void> {
    await this.serial(() => this.begin(job));
  }

  /** Cleared with its session: the container, the harness's record, the state and every alarm are dropped. */
  async clear(): Promise<void> {
    await this.serial(async () => {
      if (this.harness) {
        await this.harness.abort().catch(() => false);
        await this.harness.stop().catch(() => undefined);
      }
      log.info("builder cleared", { sessionId: this.ctx.id.name ?? null });
      await this.destroy();
    });
  }

  /** A user message for the builder: the reply it waits for, kept for the next turn, or a wake-up of a finished job. */
  async continueWith(text: string): Promise<void> {
    await this.serial(async () => {
      const state = await this.load();
      if (state.active) {
        await this.heard(state);
        state.pending.push(text);
        await this.save(state);
        return;
      }
      if (state.waiting) {
        await this.heard(state);
        const run = state.waiting;
        state.waiting = null;
        run.phase = "agent";
        run.prompt = {
          kind: "continue",
          message: this.takePending(state, text),
          // A reply mid-job: main is fetched once per continuation, at its start.
          sync: "Main was not fetched again for this reply.",
        };
        await this.session(state).builderStatus("building");
        await this.startRun(state, run);
        return;
      }
      const sessionId = state.sessionId ?? this.ctx.id.name;
      if (!sessionId) throw new Error("This builder has no session");
      const job = await continueJob({
        sessionId,
        request: await this.lastRequest(sessionId),
        message: text,
      });
      await this.begin(job);
    });
  }

  async status(): Promise<{
    active: boolean;
    waiting: boolean;
    running: boolean;
    mode: BuilderMode | null;
  }> {
    const state = await this.load();
    const container = this.harness ? await this.harness.container() : null;
    return {
      active: state.active,
      waiting: state.waiting !== null,
      running: container?.running ?? false,
      mode: state.waiting?.job.mode ?? null,
    };
  }

  /** Stops the container by hand: a running job parks, as when the silence limit hits. */
  async stopContainer(): Promise<void> {
    await this.serial(async () => this.halt(await this.load()));
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

  // ── Fibers ────────────────────────────────────────────────────────────────

  /** An evicted object picks the job up from its last checkpoint. */
  async onFiberRecovered(ctx: FiberRecoveryContext): Promise<void> {
    if (!ctx.name.startsWith("job:") || !ctx.snapshot) return;
    const run = ctx.snapshot as JobRun;
    log.info("job fiber recovered", { sessionId: run.job.sessionId, phase: run.phase });
    void this.runFiber(ctx.name, (fiber) => this.execute(run, fiber));
  }

  /** Runs `task` after every earlier event has finished. */
  private serial(task: () => Promise<void>): Promise<void> {
    const next = this.chain.then(task, task);
    this.chain = next.catch((err) => log.error("builder event failed", { err }));
    return next;
  }

  // ── Jobs ──────────────────────────────────────────────────────────────────

  private async begin(job: BuilderJob): Promise<void> {
    const state = await this.load();
    if (state.active)
      throw new Error("The builder is already running a job for this session");
    state.sessionId = job.sessionId;
    state.waiting = null;
    state.createdAt ??= Date.now();
    await this.heard(state);
    if (!this.harness) {
      log.warn("no container in this deployment", {
        sessionId: job.sessionId,
        mode: job.mode,
      });
      await this.save(state);
      await this.failWithoutContainer(job);
      return;
    }
    if (job.mode === "build" || job.mode === "continue") {
      await this.session(state).builderStatus("building");
    }
    await this.startRun(state, {
      job,
      runId: crypto.randomUUID().slice(0, 8),
      phase: "prepare",
      turn: 0,
      prompt: null,
      outcome: null,
      fixRound: 0,
      sync: null,
      mergedHead: null,
    });
  }

  private async startRun(state: BuilderState, run: JobRun): Promise<void> {
    state.active = true;
    await this.save(state);
    log.info("job started", {
      sessionId: run.job.sessionId,
      mode: run.job.mode,
      phase: run.phase,
    });
    void this.runFiber(`job:${run.job.sessionId}`, (fiber) =>
      this.execute(run, fiber),
    ).catch((err) =>
      log.error("job fiber failed", { err, sessionId: run.job.sessionId }),
    );
  }

  /** The fiber: one phase at a time, checkpointed before each, until the run parks or ends. */
  private async execute(run: JobRun, fiber: FiberContext): Promise<void> {
    try {
      for (;;) {
        fiber.stash(run);
        const next = await this.phase(run);
        if (next === "park") {
          const state = await this.load();
          state.waiting = run;
          state.active = false;
          await this.save(state);
          return;
        }
        if (next === "end") break;
      }
    } catch (err) {
      const state = await this.load();
      if (state.timedOut) {
        await this.timedOut(run, state);
        return;
      }
      log.error("job failed", { err, sessionId: run.job.sessionId, phase: run.phase });
      const text = messageOf(err);
      await this.session(state).relay({ role: "builder", text });
      await this.finish(run, "failed", { error: firstLine(text) });
    } finally {
      const state = await this.load();
      state.active = false;
      await this.save(state);
    }
  }

  /** One phase of the run; what it returns says what happens next. */
  private async phase(run: JobRun): Promise<Next> {
    const { job } = run;
    const session = this.session(await this.load());
    switch (run.phase) {
      case "prepare": {
        switch (job.mode) {
          case "build": {
            const result = await this.step<PrepareBuildResult>(run, "prepare-build");
            run.sync = result.sync ?? null;
            run.phase = "install";
            return "continue";
          }
          case "continue": {
            const result = await this.step<PrepareContinueResult>(
              run,
              "prepare-continue",
            );
            run.sync = result.sync;
            run.phase = "install";
            return "continue";
          }
          case "merge": {
            const result = await this.step<MergeMainResult>(run, "merge-main");
            run.mergedHead = result.headCommit;
            run.phase = "install";
            return "continue";
          }
          case "abandon":
            await this.step(run, "prepare-cleanup");
            run.phase = "cleanup";
            return "continue";
        }
        break;
      }
      case "install": {
        await this.step(run, "install");
        if (job.mode === "merge") {
          run.phase = "deploy-production";
          return "continue";
        }
        const state = await this.load();
        run.prompt =
          job.mode === "build"
            ? job.upstream
              ? { kind: "upstream", extra: this.takePending(state), sync: run.sync ?? "" }
              : { kind: "build", extra: this.takePending(state) }
            : {
                kind: "continue",
                message: this.takePending(
                  state,
                  job.mode === "continue" ? job.message : "",
                ),
                sync: run.sync ?? "",
              };
        await this.save(state);
        run.phase = "agent";
        return "continue";
      }
      case "agent": {
        const outcome = await this.agentTurn(run);
        if (outcome.status === "blocked") {
          await session.relay({
            role: "builder",
            text: outcome.message || "The builder could not complete this change.",
          });
          await this.finish(run, "failed", { error: "blocked" });
          return "end";
        }
        if (outcome.status === "question") {
          await session.relay({
            role: "builder",
            text: outcome.message || "The builder has a question.",
          });
          const state = await this.load();
          if (state.pending.length) {
            // The answer arrived while the agent was still asking.
            run.prompt = {
              kind: "continue",
              message: this.takePending(state),
              sync: "Main was not fetched again for this reply.",
            };
            await this.save(state);
            return "continue";
          }
          await session.builderStatus("waiting");
          return "park";
        }
        run.outcome = run.outcome
          ? {
              ...outcome,
              summary: run.outcome.summary || outcome.summary,
              reasoning: run.outcome.reasoning || outcome.reasoning,
            }
          : outcome;
        run.phase = "verify";
        return "continue";
      }
      case "verify": {
        const { failure } = await this.step<VerifyResult>(run, "verify");
        if (!failure) {
          run.phase = "commit-push";
          return "continue";
        }
        if (run.fixRound >= MAX_FIX_ROUNDS) {
          await session.relay({
            role: "builder",
            text: `Verification still fails after ${MAX_FIX_ROUNDS} fix attempts (${failure.label}).\n\n\`\`\`\n${failure.output}\n\`\`\``,
          });
          await this.finish(run, "failed", { error: `${failure.label} failed` });
          return "end";
        }
        run.fixRound += 1;
        await session.progress(
          `${failure.label} failed; asking the agent to fix it (round ${run.fixRound}/${MAX_FIX_ROUNDS})`,
        );
        run.prompt = { kind: "fix", command: failure.label, output: failure.output };
        run.phase = "agent";
        return "continue";
      }
      case "commit-push": {
        const outcome = run.outcome!;
        const { committed } = await this.step<CommitPushResult>(run, "commit-push", {
          summary: outcome.summary,
          reasoning: outcome.reasoning,
          request: job.mode === "continue" ? job.message : job.request,
        });
        log.info("branch pushed", { sessionId: job.sessionId, committed });
        await session.builderStatus("deploying");
        run.phase = "deploy-preview";
        return "continue";
      }
      case "deploy-preview": {
        const result = await this.step<DeployResult>(run, "deploy-preview");
        // The Preview URL is not for people: the session posts the branch link once
        // the deploy is recorded. Only the agent's own words go here.
        await session.relay({
          role: "builder",
          text: run.outcome?.message.trim() || "The change is ready.",
        });
        await this.finish(run, "deployed", result);
        return "end";
      }
      case "deploy-production":
        await this.step(run, "deploy-production");
        run.phase = "cleanup";
        return "continue";
      case "cleanup":
        await this.step(run, "cleanup");
        if (job.mode === "merge") {
          await session.relay({
            role: "builder",
            text: "Merged into main and deployed.",
          });
          await this.finish(run, "merged", { headCommit: run.mergedHead ?? undefined });
        } else {
          await session.relay({ role: "builder", text: "Branch abandoned." });
          await this.finish(run, "abandoned");
        }
        return "end";
    }
    throw new Error(`unknown phase ${String(run.phase)}`);
  }

  /** Pending user messages joined with `first`, and cleared. */
  private takePending(state: BuilderState, first = ""): string {
    const text = [first, ...state.pending].filter((part) => part.trim()).join("\n\n");
    state.pending = [];
    return text;
  }

  /** Terminal status: tell the session; the harness stops the container once it idles. */
  private async finish(
    run: JobRun,
    status: "deployed" | "failed" | "merged" | "abandoned",
    detail?: BuilderStatusDetail,
  ): Promise<void> {
    const { job } = run;
    log.info("job finished", { sessionId: job.sessionId, mode: job.mode, status });
    if (status === "failed" && (job.mode === "merge" || job.mode === "abandon")) {
      await markReady(job.branch.id).catch((err) =>
        log.warn("mark ready failed", { err, sessionId: job.sessionId }),
      );
    }
    const state = await this.load();
    state.waiting = null;
    state.pending = [];
    await this.forgetSilenceCheck(state);
    await this.save(state);
    await this.session(state).builderStatus(status, detail);
    // Nothing more comes for a deployed, merged or abandoned job: the container
    // goes now, its workspace snapshotted. A failed job is left to the idle
    // stop, like a question: a fix may follow within minutes.
    if (status !== "failed" && this.harness) {
      await this.harness
        .stop()
        .catch((err) =>
          log.warn("container stop failed", { err, sessionId: job.sessionId }),
        );
    }
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
      await this.harness.abort().catch(() => false);
    }
    await this.harness
      .stop()
      .catch((err) =>
        log.warn("container stop failed", { err, sessionId: state.sessionId }),
      );
    log.info("builder halted", { sessionId: state.sessionId, active: state.active });
  }

  /**
   * The silence limit hit mid-run. A build parks, to resume on the next
   * message; a merge or an abandon cannot resume, so it fails.
   */
  private async timedOut(run: JobRun, state: BuilderState): Promise<void> {
    const { job } = run;
    state.timedOut = false;
    log.info("job timed out", {
      sessionId: job.sessionId,
      mode: job.mode,
      phase: run.phase,
    });
    if (job.mode === "merge" || job.mode === "abandon") {
      await this.save(state);
      await this.session(state).relay({
        role: "builder",
        text: `The ${job.mode} stopped: thirty minutes passed without a message. Start it again from the branch menu.`,
      });
      await this.finish(run, "failed", { error: "timed out" });
      return;
    }
    state.waiting = run;
    await this.save(state);
    const session = this.session(state);
    await session.relay({ role: "builder", text: TIMED_OUT_TEXT });
    await session.builderStatus("timed_out");
  }

  // ── Turns ─────────────────────────────────────────────────────────────────

  /** One step, as a harness turn; its result, or the error it reported, thrown. */
  private async step<T = unknown>(
    run: JobRun,
    name: StepName,
    input?: StepInput,
  ): Promise<T> {
    const request: TurnRequest = { kind: "step", step: name, job: run.job, input };
    const result = await this.turn(run, request, STEP_TIMEOUT_MS);
    if (result.status !== "done")
      throw new Error(result.reason ?? `the ${name} step failed`);
    return JSON.parse(result.text || "{}") as T;
  }

  /** One agent turn on `run.prompt`; the structured outcome it ended with. */
  private async agentTurn(run: JobRun): Promise<AgentOutcome> {
    const request: TurnRequest = {
      kind: "agent",
      prompt: run.prompt!,
      job: run.job,
      model: await getBuilderModel(),
    };
    const result = await this.turn(run, request, AGENT_TURN_TIMEOUT_MS);
    if (result.status !== "done") {
      throw new Error(`The coding agent failed: ${result.reason ?? "no result"}`);
    }
    const outcome = toOutcome(parseJson(result.text ?? ""));
    if (!outcome) throw new Error("The coding agent ended without reporting an outcome.");
    return outcome;
  }

  /**
   * Submits a turn and waits for it, relaying its events to the chat. The
   * operation id is the run's id and turn number, so a recovered fiber that
   * submits the same turn again gets the operation already under way, while
   * a later job on the session never meets an earlier job's results.
   */
  private async turn(
    run: JobRun,
    request: TurnRequest,
    timeoutMs: number,
  ): Promise<ContainerOperationResult> {
    const harness = this.harness!;
    run.turn += 1;
    // A run checkpointed before runs had ids keeps the ids it started with.
    const operationId = run.runId
      ? `${run.job.sessionId}:${run.runId}:${run.turn}`
      : `${run.job.sessionId}:${run.turn}`;
    const session = harness.session();
    const stream = await session.events();
    const relay = new EventRelay(
      this.session(await this.load()),
      stream.snapshot.messages,
    );
    stream.start((events) => {
      this.relaying = this.relaying
        .then(() => relay.handle(events))
        .catch((err) => log.warn("event relay failed", { err }));
    });
    try {
      await session.submit(JSON.stringify(request), { operationId });
      const timeout = AbortSignal.timeout(timeoutMs);
      let result: ContainerOperationResult;
      try {
        result = await session.wait(operationId, timeout);
      } catch (err) {
        if (!timeout.aborted) throw err;
        await session.abort(operationId).catch(() => false);
        throw new Error(
          `The ${request.kind === "step" ? `${request.step} step` : "coding agent"} did not finish within ${Math.round(timeoutMs / 60000)} minutes.`,
          { cause: err },
        );
      }
      await this.relaying;
      return result;
    } finally {
      await stream.stop().catch(() => undefined);
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────

  private async failWithoutContainer(job: BuilderJob): Promise<void> {
    if (job.mode === "merge" || job.mode === "abandon") await markReady(job.branch.id);
    await this.env.BUILD_SESSIONS.getByName(job.sessionId).builderStatus("failed", {
      error: "The builder container is not available in this deployment",
    });
  }

  private session(state: BuilderState) {
    const sessionId = state.sessionId ?? this.ctx.id.name;
    if (!sessionId) throw new Error("This builder has no session");
    return this.env.BUILD_SESSIONS.getByName(sessionId);
  }

  private async lastRequest(sessionId: string): Promise<string> {
    return (
      (await this.ctx.storage.get<string>("request")) ??
      `Continue the work on session ${sessionId}`
    );
  }

  private async load(): Promise<BuilderState> {
    const stored = await this.ctx.storage.get<BuilderState>(STATE_KEY);
    return { ...EMPTY_STATE, ...stored, pending: stored?.pending ?? [] };
  }

  private async save(state: BuilderState): Promise<void> {
    if (state.waiting?.job.mode === "build") {
      await this.ctx.storage.put("request", state.waiting.job.request);
    }
    await this.ctx.storage.put(STATE_KEY, state);
  }
}

/**
 * Turns a turn's events into chat lines: a step's progress and log lines,
 * and what the coding agent thinks, says and does, as each part of its
 * messages first appears.
 */
class EventRelay {
  /** Parts already described, per message id. */
  private readonly described = new Map<string, number>();
  private readonly failedTools = new Set<string>();

  constructor(
    private readonly link: { progress(text: string, kind?: "log"): Promise<void> },
    snapshot: readonly ContainerMessage[],
  ) {
    for (const message of snapshot) this.described.set(message.id, message.parts.length);
  }

  async handle(events: readonly ContainerSessionEvent[]): Promise<void> {
    const logs: string[] = [];
    const lines: string[] = [];
    for (const event of events) {
      if (event.type === "raw") {
        const line = asStepLine(event.value);
        if (!line) continue;
        if (line.type === "progress") lines.push(line.text);
        else if (line.type === "log") logs.push(line.text);
      } else if (event.type === "log") {
        logs.push(event.message);
      } else if (event.type === "message") {
        lines.push(...this.describe(event.message));
      }
    }
    if (logs.length) await this.link.progress(tail(logs, 40).join("\n"), "log");
    for (const text of lines) await this.link.progress(text);
  }

  private describe(message: ContainerMessage): string[] {
    if (message.role !== "assistant") return [];
    const seen = this.described.get(message.id) ?? 0;
    const out: string[] = [];
    message.parts.forEach((part, index) => {
      if (
        part.type === "tool" &&
        part.state === "error" &&
        !this.failedTools.has(part.toolCallId)
      ) {
        this.failedTools.add(part.toolCallId);
        out.push(`tool failed: ${clip(toolOutputText(part.output))}`);
      }
      if (index < seen) return;
      if (part.type === "text" && part.text.trim()) out.push(`agent: ${clip(part.text)}`);
      else if (part.type === "reasoning" && part.text.trim())
        out.push(`thinking: ${clip(part.text)}`);
      else if (part.type === "tool") out.push(describeTool(part.toolName, part.input));
    });
    this.described.set(message.id, Math.max(seen, message.parts.length));
    return out;
  }
}

const CLIP_CHARS = 240;

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

function toOutcome(value: unknown): AgentOutcome | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  if (status !== "done" && status !== "question" && status !== "blocked") return null;
  return {
    status,
    summary: typeof value.summary === "string" ? value.summary : "",
    reasoning: typeof value.reasoning === "string" ? value.reasoning : "",
    message: typeof value.message === "string" ? value.message : "",
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() || "failed";
}

function tail<T>(items: T[], count: number): T[] {
  return items.slice(Math.max(0, items.length - count));
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
