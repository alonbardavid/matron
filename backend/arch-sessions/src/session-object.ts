import { Agent, type Connection, type ConnectionContext, type WSMessage } from "agents";
import {
  branchForSession,
  createBranch,
  markDeployed,
  archiveBranch,
  type BranchRow,
} from "@backend/arch-branches/service";
import { logger } from "@backend/commons/logger";
import { ROLES, type Principal, type Role } from "@backend/commons/principal";
import type {
  BuilderStatusDetail,
  BuilderUpstream,
} from "@backend/arch-builder/protocol";
import { sessionStatusFor, type RelayedStatus } from "@backend/arch-builder/events";
import { buildJob } from "@backend/arch-builder/jobs";
import { mainHead } from "@backend/arch-repository/service";
import { plan } from "@backend/arch-planner/planner";
import {
  BUILD_FAILED_MESSAGE,
  BUILD_STARTED_MESSAGE,
  DEPLOYED_MESSAGE,
  SESSION_CLOSED_MESSAGE,
} from "./messages";
import {
  clientFrameSchema,
  type ChatFrame,
  type ChatRole,
  type ServerFrame,
} from "@shared/contract/arch/sessions";
import {
  markSessionArchived,
  setSessionStatus,
  touchSession,
  setSessionTitle,
  SOCKET_HEADERS,
} from "./service";
import { Transcript } from "./transcript";

const log = logger("arch-sessions/session-object");

type Phase =
  "planning" | "building" | "waiting" | "deployed" | "failed" | "timed_out" | "closed";

/** Synced to every connected client as it changes. */
export interface SessionState {
  phase: Phase;
}

/** Who is behind a connection; kept on it so it survives hibernation. */
interface Attachment {
  principal: Principal;
}

const TITLE_LENGTH = 80;

/**
 * One build session: the chat connections, the transcript, the planner, and
 * the bridge to the builder. Named by the session id. An Agent: its
 * connections hibernate, and what it keeps lives in its SQLite storage. A new
 * connection gets the transcript replayed from the frame it names, then a
 * `synced` frame, then every frame the object broadcasts. Its state, the
 * phase, is synced to every client as it changes.
 */
export class BuildSessionObject extends Agent<Cloudflare.Env, SessionState> {
  initialState: SessionState = { phase: "planning" };
  private readonly transcript: Transcript;
  // User messages are handled one at a time: the planner must see its own
  // previous answer before it reads the next question.
  private inbox: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.transcript = new Transcript(ctx.storage.sql);
  }

  // ── Connections ───────────────────────────────────────────────────────────

  /** The upgrade request the router forwarded, with the identity in headers. */
  async onConnect(
    connection: Connection<Attachment>,
    ctx: ConnectionContext,
  ): Promise<void> {
    const { request } = ctx;
    const sessionId = request.headers.get(SOCKET_HEADERS.sessionId);
    if (sessionId) this.transcript.set("sessionId", sessionId);
    const principal = readPrincipal(request.headers);
    if (!principal) {
      connection.close(1008, "Missing identity");
      return;
    }
    connection.setState({ principal });
    log.info("socket accepted", {
      sessionId: this.sessionId(),
      userId: principal.userId,
    });
    const after = new URL(request.url).searchParams.get("after");
    for (const frame of this.transcript.listAfter(after)) this.send(connection, frame);
    this.send(connection, { type: "synced" });
  }

  /** A user message typed on a connection; handled in order. */
  async onMessage(connection: Connection<Attachment>, message: WSMessage): Promise<void> {
    if (typeof message !== "string") return;
    const parsed = clientFrameSchema.safeParse(parseJson(message));
    if (!parsed.success) {
      this.send(connection, errorFrame("The message was not accepted"));
      return;
    }
    const principal = connection.state?.principal;
    if (!principal) {
      this.send(connection, errorFrame("Unknown connection"));
      return;
    }
    this.inbox = this.inbox
      .then(() => this.handleUserMessage(principal, parsed.data.text))
      .catch((err) => {
        log.error("user message failed", { err, sessionId: this.sessionId() });
        this.broadcastFrame(errorFrame("Something went wrong handling your message"));
      });
    await this.inbox;
  }

  onClose(_connection: Connection, code: number): void {
    log.debug("socket closed", { sessionId: this.sessionId(), code });
  }

  onError(connectionOrError: Connection | unknown, error?: unknown): void {
    log.warn("socket error", {
      err: error ?? connectionOrError,
      sessionId: this.sessionId(),
    });
  }

  // ── RPC from the BuilderObject ────────────────────────────────────────────

  /** A builder message for the chat. */
  async relay(frame: { role: "builder"; text: string }): Promise<void> {
    this.post(frame.role, frame.text);
  }

  /**
   * An origin update: started by the owner from troubleshooting rather than
   * typed, so the request and the plan come written and the build starts at
   * once. From then on it is a build session like any other: its chat takes
   * follow-ups, and its branch merges from the branch menu.
   */
  async startUpstreamBuild(
    who: Principal,
    input: {
      sessionId: string;
      title: string;
      request: string;
      plan: string;
      upstream: BuilderUpstream;
    },
  ): Promise<{ branchId: string }> {
    this.transcript.set("sessionId", input.sessionId);
    if (this.transcript.firstUserMessage() !== null) {
      throw new Error("This session has already started");
    }
    this.transcript.set("title", input.title);
    await setSessionTitle(input.sessionId, input.title);
    this.broadcastFrame(this.transcript.append("user", input.request));
    this.transcript.set("plan", input.plan);
    this.post("planner", input.plan);
    const branch = await this.startBuild(who, input.plan, {
      name: "origin update",
      upstream: input.upstream,
    });
    return { branchId: branch.id };
  }

  /** Archived by hand: the chat stays readable and answers nothing but the closed notice. */
  async archive(): Promise<void> {
    this.setPhase("closed");
  }

  /** Cleared: every message and state entry is gone; open connections are closed. */
  async clear(): Promise<void> {
    for (const connection of this.getConnections()) {
      try {
        connection.close(1000, "cleared");
      } catch {
        // Already gone.
      }
    }
    this.transcript.wipe();
    log.info("session cleared", { sessionId: this.sessionId() });
  }

  /** What the planner or builder is doing, shown in the chat as it happens. */
  async progress(text: string, kind?: "log"): Promise<void> {
    this.broadcastFrame(this.transcript.appendProgress(text, kind));
  }

  /** The builder's progress; the session row and the branch row follow it. */
  async builderStatus(
    status: RelayedStatus,
    detail?: BuilderStatusDetail,
  ): Promise<void> {
    const sessionId = this.sessionId();
    log.info("builder status", { sessionId, status });
    if (this.transcript.get<Phase>("phase") === "closed") {
      // Archived meanwhile: a late builder report must not reopen the session.
      log.info("builder status ignored: session closed", { sessionId, status });
      return;
    }
    switch (status) {
      case "building":
      case "deploying":
      case "waiting":
        this.setPhase(status === "waiting" ? "waiting" : "building");
        await setSessionStatus(sessionId, sessionStatusFor(status));
        return;
      case "deployed":
        await this.onDeployed(sessionId, detail);
        return;
      case "failed":
        this.setPhase("failed");
        await setSessionStatus(sessionId, "failed");
        this.post(
          "builder",
          BUILD_FAILED_MESSAGE.replace("{error}", detail?.error ?? "unknown error"),
        );
        return;
      case "timed_out":
        // The builder explained itself in the chat; the next message resumes the run.
        this.setPhase("timed_out");
        await setSessionStatus(sessionId, "timed_out");
        return;
      case "merged":
      case "abandoned": {
        const branchId = await this.branchId(sessionId);
        if (branchId) await archiveBranch(branchId, status);
        this.setPhase("closed");
        await setSessionStatus(sessionId, status);
        await markSessionArchived(sessionId);
        this.post(
          "planner",
          status === "merged"
            ? "The branch was merged into production and archived."
            : "The branch was abandoned and archived.",
        );
        return;
      }
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async handleUserMessage(who: Principal, text: string): Promise<void> {
    const sessionId = this.sessionId();
    this.broadcastFrame(this.transcript.append("user", text));
    await touchSession(sessionId);
    if (!this.transcript.get<string>("title")) {
      const title = text.replace(/\s+/g, " ").trim().slice(0, TITLE_LENGTH);
      this.transcript.set("title", title);
      await setSessionTitle(sessionId, title);
    }
    const phase = this.transcript.get<Phase>("phase") ?? "planning";
    switch (phase) {
      case "planning":
        await this.runPlanner(who);
        return;
      case "closed":
        this.post("planner", SESSION_CLOSED_MESSAGE);
        return;
      case "building":
        await this.env.BUILDERS.getByName(sessionId).continueWith(text);
        return;
      case "waiting":
      case "deployed":
      case "failed":
      case "timed_out":
        await this.env.BUILDERS.getByName(sessionId).continueWith(text);
        this.setPhase("building");
        await setSessionStatus(sessionId, "building");
        return;
    }
  }

  private async runPlanner(who: Principal): Promise<void> {
    const sessionId = this.sessionId();
    let reply;
    try {
      await this.progress("planner: reading the request");
      reply = await plan({
        sessionId,
        transcript: this.transcript.planningTurns(),
        previousPlan: this.transcript.get<string>("plan"),
        onProgress: (text) => void this.progress(text),
      });
    } catch (err) {
      log.error("planner failed", { err, sessionId });
      this.broadcastFrame(errorFrame(`The planner is not available: ${messageOf(err)}`));
      return;
    }
    if (reply.status === "plan" && reply.plan) {
      this.transcript.set("plan", reply.plan);
      if (reply.name) this.transcript.set("branchName", reply.name);
    }
    this.post("planner", reply.text);
    if (reply.status === "approved" && reply.plan) {
      try {
        await this.startBuild(who, reply.plan);
      } catch (err) {
        log.error("build start failed", { err, sessionId });
        this.broadcastFrame(errorFrame(`The build could not start: ${messageOf(err)}`));
      }
    }
  }

  private async startBuild(
    who: Principal,
    planText: string,
    options: { name?: string; upstream?: BuilderUpstream } = {},
  ): Promise<BranchRow> {
    const sessionId = this.sessionId();
    const title = this.transcript.get<string>("title") ?? "Untitled change";
    const request = this.transcript.firstUserMessage() ?? title;
    const branch = await createBranch(who, {
      buildSessionId: sessionId,
      name: options.name ?? this.transcript.get<string>("branchName") ?? title,
      baseCommit: await mainHead(),
      upstreamCommit: options.upstream?.commit,
    });
    this.transcript.set("branchId", branch.id);
    this.setPhase("building");
    await setSessionStatus(sessionId, "building");
    const job = await buildJob({
      sessionId,
      branch,
      request,
      plan: planText,
      upstream: options.upstream,
    });
    await this.env.BUILDERS.getByName(sessionId).startBuild(job);
    log.info("build started", {
      sessionId,
      branchId: branch.id,
      upstream: options.upstream?.commit ?? null,
    });
    this.post("planner", BUILD_STARTED_MESSAGE.replace("{title}", title));
    return branch;
  }

  private async onDeployed(
    sessionId: string,
    detail?: BuilderStatusDetail,
  ): Promise<void> {
    const branchId = await this.branchId(sessionId);
    if (!branchId || !detail?.previewUrl) {
      log.error("deploy reported without branch or preview url", { sessionId, branchId });
      await this.builderStatus("failed", {
        error: "the builder reported a deploy without a Preview URL",
      });
      return;
    }
    await markDeployed(branchId, {
      previewUrl: detail.previewUrl,
      databaseId: detail.databaseId ?? "",
      headCommit: detail.headCommit ?? "",
      baseCommit: detail.baseCommit,
    });
    this.setPhase("deployed");
    await setSessionStatus(sessionId, "deployed");
    // The branch link is explained once; later deploys speak through the builder's own message.
    if (this.transcript.get<boolean>("deployedOnce")) return;
    this.transcript.set("deployedOnce", true);
    const url = `${this.env.APP_ORIGIN}/?branch=${encodeURIComponent(branchId)}`;
    this.post("planner", DEPLOYED_MESSAGE.replace("{url}", url));
  }

  private async branchId(sessionId: string): Promise<string | null> {
    const stored = this.transcript.get<string>("branchId");
    if (stored) return stored;
    const branch = await branchForSession(sessionId);
    if (branch) this.transcript.set("branchId", branch.id);
    return branch?.id ?? null;
  }

  private sessionId(): string {
    return (
      this.transcript.get<string>("sessionId") ??
      this.ctx.id.name ??
      this.ctx.id.toString()
    );
  }

  private setPhase(phase: Phase): void {
    this.transcript.set("phase", phase);
    this.setState({ phase });
  }

  /** Stores a server message and sends it to everyone connected. */
  private post(role: Exclude<ChatRole, "user">, text: string): void {
    this.broadcastFrame(this.transcript.append(role, text));
    void touchSession(this.sessionId()).catch((err: unknown) =>
      log.warn("touch failed", { err }),
    );
  }

  private broadcastFrame(frame: ServerFrame): void {
    this.broadcast(JSON.stringify(frame));
  }

  private send(connection: Connection, frame: ServerFrame): void {
    try {
      connection.send(JSON.stringify(frame));
    } catch (err) {
      log.debug("send failed", { err });
    }
  }
}

function readPrincipal(headers: Headers): Principal | null {
  const userId = headers.get(SOCKET_HEADERS.userId);
  const role = headers.get(SOCKET_HEADERS.userRole);
  if (!userId || !role || !(ROLES as readonly string[]).includes(role)) return null;
  return {
    userId,
    name: headers.get(SOCKET_HEADERS.userName) ?? "",
    email: headers.get(SOCKET_HEADERS.userEmail) ?? "",
    role: role as Role,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorFrame(text: string): ChatFrame {
  return { type: "error", id: crypto.randomUUID(), ts: Date.now(), text };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
