import { DurableObject } from "cloudflare:workers";
import { markReady } from "@backend/arch-branches/service";
import { logger } from "@backend/commons/logger";
import { AI_GATEWAY } from "@backend/commons/names";
import {
  BUILDER_PORT,
  type AbandonJob,
  type BuildJob,
  type BuilderEvent,
  type BuilderJob,
  type BuilderMode,
  type BuilderSocketFrame,
  type BuilderStatusDetail,
  type MergeJob,
} from "./protocol";
import type { BuilderEnv } from "./env";
import { isRelayedStatus, keepsSnapshot, reduceEvents, waitedTooLong } from "./events";
import { continueJob } from "./jobs";

const log = logger("arch-builder/builder-object");

/** The image name in the generated config's `containers[].images` (scripts/lib/wrangler-config.mjs). */
const BUILDER_IMAGE_NAME = "builder";
const BUILDER_INSTANCE = "standard-2";
const WATCHDOG_MS = 30_000;
const HEALTH_TIMEOUT_MS = 60_000;
const MAX_CONNECT_FAILURES = 10;
const STATE_KEY = "state";

interface ActiveJob {
  mode: BuilderMode;
  branchId: string;
  /** The user's original request, repeated on continuations. */
  request: string;
  startedAt: number;
}

interface BuilderState {
  sessionId: string | null;
  lastSeq: number;
  activeJob: ActiveJob | null;
  snapshot: ContainerSnapshot | null;
  /** When the builder reported `waiting`; cleared when it resumes. */
  waitingSince: number | null;
  /** User messages that could not be sent yet: the container was starting or the socket was down. */
  pending: string[];
  connectFailures: number;
}

const EMPTY_STATE: BuilderState = {
  sessionId: null,
  lastSeq: 0,
  activeJob: null,
  snapshot: null,
  waitingSince: null,
  pending: [],
  connectFailures: 0,
};

/**
 * Drives the builder container for one session: starts it (fresh or from a
 * snapshot), posts the job, holds a WebSocket into it on which the builder's
 * events arrive and the user's messages leave, and snapshots and stops it when
 * the builder pauses or finishes. Named by the session id, like the session
 * object. The open socket keeps this object in memory; a watchdog alarm
 * reconnects it after an eviction and enforces the waiting grace period.
 */
export class BuilderObject extends DurableObject<BuilderEnv> {
  // True between `start()` and the job being accepted; messages wait meanwhile.
  private launching = false;
  private socket: WebSocket | null = null;
  // Events are handled one at a time, in arrival order.
  private chain: Promise<void> = Promise.resolve();

  // ── RPC ───────────────────────────────────────────────────────────────────

  async startBuild(job: BuildJob): Promise<void> {
    await this.run(job, null);
  }

  /** Cleared with its session: the container, snapshot handle and state are dropped. */
  async clear(): Promise<void> {
    this.closeSocket();
    this.launching = false;
    await this.stopContainer();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    log.info("builder cleared");
  }

  async startMerge(job: MergeJob): Promise<void> {
    await this.run(job, null);
  }

  async startAbandon(job: AbandonJob): Promise<void> {
    await this.run(job, null);
  }

  /** A user message for the builder: delivered live, or wakes it from its snapshot. */
  async continueWith(text: string): Promise<void> {
    const state = await this.load();
    if (state.activeJob) {
      if (this.launching) {
        state.pending.push(text);
      } else {
        await this.send(state, text);
        state.waitingSince = null;
      }
      await this.save(state);
      return;
    }
    const sessionId = state.sessionId ?? this.ctx.id.name;
    if (!sessionId) throw new Error("This builder has no session");
    const job = await continueJob({
      sessionId,
      request: await this.lastRequest(sessionId),
      message: text,
    });
    await this.run(job, state.snapshot);
  }

  async status(): Promise<{
    activeJob: ActiveJob | null;
    running: boolean;
    connected: boolean;
    hasSnapshot: boolean;
    lastSeq: number;
  }> {
    const state = await this.load();
    return {
      activeJob: state.activeJob,
      running: this.ctx.container?.running ?? false,
      connected: this.socket !== null,
      hasSnapshot: state.snapshot !== null,
      lastSeq: state.lastSeq,
    };
  }

  // ── Watchdog ──────────────────────────────────────────────────────────────

  async alarm(): Promise<void> {
    await this.serial(async () => {
      const state = await this.load();
      const container = this.ctx.container;
      if (!state.activeJob || !container) return;
      if (!container.running) {
        await this.finish(state, "failed", {
          error: "the builder container exited unexpectedly",
        });
        return;
      }
      if (waitedTooLong(state.waitingSince, Date.now())) {
        log.info("builder waited too long; parking", { sessionId: state.sessionId });
        await this.park(state);
        return;
      }
      if (!this.socket) {
        try {
          await this.openSocket(state);
        } catch (err) {
          state.connectFailures += 1;
          log.warn("builder reconnect failed", {
            err,
            sessionId: state.sessionId,
            failures: state.connectFailures,
          });
          if (state.connectFailures >= MAX_CONNECT_FAILURES) {
            await this.finish(state, "failed", {
              error: "the builder container stopped responding",
            });
            return;
          }
        }
      }
      await this.save(state);
      await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_MS);
    });
  }

  // ── The socket ────────────────────────────────────────────────────────────

  /** Opens the socket from `state.lastSeq` and flushes pending messages on it. */
  private async openSocket(state: BuilderState): Promise<void> {
    const response = await this.port().fetch(
      `http://container/ws?after=${state.lastSeq}`,
      { headers: { Upgrade: "websocket" } },
    );
    const socket = response.webSocket;
    if (!socket)
      throw new Error(`the builder did not open the socket (${response.status})`);
    socket.accept();
    this.socket = socket;
    state.connectFailures = 0;
    socket.addEventListener("message", (event) => {
      void this.serial(() => this.handleEvent(event.data));
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = null;
      log.info("builder socket closed", { sessionId: state.sessionId });
    });
    socket.addEventListener("error", (event) => {
      if (this.socket === socket) this.socket = null;
      log.warn("builder socket error", { err: event, sessionId: state.sessionId });
    });
    log.info("builder socket open", { sessionId: state.sessionId, after: state.lastSeq });
    for (const text of state.pending) this.sendFrame({ type: "message", text });
    state.pending = [];
  }

  /** Sends a user message now, or keeps it for the next connection. */
  private async send(state: BuilderState, text: string): Promise<void> {
    if (!this.socket) {
      try {
        await this.openSocket(state);
      } catch (err) {
        log.warn("builder connect failed", { err, sessionId: state.sessionId });
      }
    }
    if (this.socket) this.sendFrame({ type: "message", text });
    else state.pending.push(text);
  }

  private sendFrame(frame: BuilderSocketFrame): void {
    this.socket?.send(JSON.stringify(frame));
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close(1000, "done");
    } catch {
      // Already gone.
    }
  }

  private async handleEvent(raw: string | ArrayBuffer): Promise<void> {
    let event: BuilderEvent;
    try {
      event = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch (err) {
      log.warn("bad builder event", { err });
      return;
    }
    const state = await this.load();
    if (!state.activeJob) return;
    const reduced = reduceEvents([event], state.lastSeq);
    if (reduced.lastSeq === state.lastSeq) return;
    state.lastSeq = reduced.lastSeq;
    const session = this.session(state);
    for (const text of reduced.logs) await session.progress(text, "log");
    for (const text of reduced.progress) await session.progress(text);
    for (const text of reduced.messages) await session.relay({ role: "builder", text });
    for (const { status, detail } of reduced.statuses) {
      if (status === "waiting") state.waitingSince ??= Date.now();
      else state.waitingSince = null;
      if (!reduced.terminal && isRelayedStatus(status))
        await session.builderStatus(status, detail);
    }
    if (reduced.terminal) {
      await this.finish(state, reduced.terminal.status, reduced.terminal.detail);
    } else {
      await this.save(state);
    }
  }

  /** Runs `task` after every earlier event handler has finished. */
  private serial(task: () => Promise<void>): Promise<void> {
    const next = this.chain.then(task, task);
    this.chain = next.catch((err) => log.error("builder event failed", { err }));
    return next;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Starts the container (restoring `snapshot` when given), posts the job and connects. */
  private async run(job: BuilderJob, snapshot: ContainerSnapshot | null): Promise<void> {
    const state = await this.load();
    if (state.activeJob || this.launching) {
      throw new Error("The builder is already running a job for this session");
    }
    state.sessionId = job.sessionId;
    const container = this.ctx.container;
    if (!container) {
      log.warn("no container in this deployment", {
        sessionId: job.sessionId,
        mode: job.mode,
      });
      await this.save(state);
      await this.failWithoutContainer(job);
      return;
    }
    state.activeJob = {
      mode: job.mode,
      branchId: job.branch.id,
      request: job.request,
      startedAt: Date.now(),
    };
    state.lastSeq = snapshot ? state.lastSeq : 0;
    state.connectFailures = 0;
    state.waitingSince = null;
    await this.save(state);

    this.launching = true;
    try {
      if (!container.running) {
        const common = {
          env: this.containerEnv(),
          enableInternet: true,
          instance: BUILDER_INSTANCE,
        } as const;
        // A snapshot carries its image; a fresh start names the deployed one.
        if (snapshot) {
          container.start({ ...common, containerSnapshot: { id: snapshot.id } });
        } else {
          const image = container.images[BUILDER_IMAGE_NAME];
          if (!image)
            throw new Error(`no "${BUILDER_IMAGE_NAME}" image on this container`);
          container.start({ ...common, image });
        }
        log.info("container started", {
          sessionId: job.sessionId,
          mode: job.mode,
          fromSnapshot: !!snapshot,
        });
      }
      await this.waitForHealth();
      const response = await this.port().fetch("http://container/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(job),
      });
      if (!response.ok)
        throw new Error(`the builder refused the job (${response.status})`);
      log.info("job posted", { sessionId: job.sessionId, mode: job.mode });
      const fresh = await this.load();
      try {
        await this.openSocket(fresh);
      } catch (err) {
        // The watchdog keeps trying.
        log.warn("builder connect failed", { err, sessionId: job.sessionId });
      }
      await this.save(fresh);
      await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_MS);
    } catch (err) {
      log.error("builder start failed", {
        err,
        sessionId: job.sessionId,
        mode: job.mode,
      });
      const fresh = await this.load();
      await this.finish(fresh, "failed", {
        error: `the builder could not start: ${messageOf(err)}`,
      });
    } finally {
      this.launching = false;
    }
  }

  /** Terminal status: tell the session, keep a snapshot where it is useful, stop the container. */
  private async finish(
    state: BuilderState,
    status: "deployed" | "failed" | "merged" | "abandoned",
    detail?: BuilderStatusDetail,
  ): Promise<void> {
    const job = state.activeJob;
    const sessionId = state.sessionId;
    log.info("job finished", { sessionId, mode: job?.mode, status });
    if (job && status === "failed" && (job.mode === "merge" || job.mode === "abandon")) {
      await markReady(job.branchId).catch((err) =>
        log.warn("mark ready failed", { err, sessionId }),
      );
    }
    await this.session(state).builderStatus(status, detail);
    this.closeSocket();
    if (job && keepsSnapshot(job.mode, status)) {
      state.snapshot = await this.snapshot(state);
    } else if (status === "merged" || status === "abandoned") {
      state.snapshot = null;
      await this.session(state)
        .builderSnapshot(null)
        .catch(() => undefined);
    }
    await this.stopContainer();
    state.activeJob = null;
    state.waitingSince = null;
    state.pending = [];
    await this.save(state);
    await this.ctx.storage.deleteAlarm();
  }

  /** The builder has waited long enough: snapshot and stop; `continueWith` restores it. */
  private async park(state: BuilderState): Promise<void> {
    this.closeSocket();
    state.snapshot = await this.snapshot(state);
    await this.stopContainer();
    state.activeJob = null;
    state.waitingSince = null;
    await this.save(state);
    await this.ctx.storage.deleteAlarm();
  }

  private async snapshot(state: BuilderState): Promise<ContainerSnapshot | null> {
    const container = this.ctx.container;
    const sessionId = state.sessionId;
    if (!container || !container.running || !sessionId) return state.snapshot;
    try {
      const snapshot = await container.snapshotContainer({ name: sessionId });
      await this.session(state)
        .builderSnapshot(snapshot)
        .catch((err) => log.warn("snapshot row update failed", { err, sessionId }));
      log.info("container snapshotted", {
        sessionId,
        snapshotId: snapshot.id,
        size: snapshot.size,
      });
      return snapshot;
    } catch (err) {
      log.error("snapshot failed", { err, sessionId });
      return state.snapshot;
    }
  }

  private async stopContainer(): Promise<void> {
    const container = this.ctx.container;
    if (!container?.running) return;
    try {
      await container.destroy();
    } catch (err) {
      log.warn("container destroy failed", { err });
    }
  }

  private async waitForHealth(): Promise<void> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    let delay = 500;
    while (Date.now() < deadline) {
      try {
        const response = await this.port().fetch("http://container/health");
        if (response.ok) return;
      } catch {
        // Not listening yet.
      }
      await sleep(delay);
      delay = Math.min(delay * 1.5, 3_000);
    }
    throw new Error("the builder container did not become healthy in time");
  }

  private async failWithoutContainer(job: BuilderJob): Promise<void> {
    if (job.mode === "merge" || job.mode === "abandon") await markReady(job.branch.id);
    await this.env.BUILD_SESSIONS.getByName(job.sessionId).builderStatus("failed", {
      error: "The builder container is not available in this deployment",
    });
  }

  private containerEnv(): Record<string, string> {
    const env = this.env;
    return {
      PORT: String(BUILDER_PORT),
      CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN ?? "",
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID ?? "",
      AI_GATEWAY,
    };
  }

  private port(): Fetcher {
    return this.ctx.container!.getTcpPort(BUILDER_PORT);
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
    if (state.activeJob?.mode === "build")
      await this.ctx.storage.put("request", state.activeJob.request);
    await this.ctx.storage.put(STATE_KEY, state);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
