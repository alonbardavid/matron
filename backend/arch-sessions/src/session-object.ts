import { DurableObject } from "cloudflare:workers";
import { ORPCError } from "@orpc/server";
import {
  branchForSession,
  createBranch,
  markDeployed,
  archiveBranch,
} from "@backend/arch-branches/service";
import { logger } from "@backend/commons/logger";
import { ROLES, type Principal, type Role } from "@backend/commons/principal";
import type { BuilderStatusDetail } from "@backend/arch-builder/protocol";
import type { SessionsEnv } from "./env";
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
import type { ChatFrame, ChatRole, ServerFrame } from "@shared/contract/arch/sessions";
import { chatHandler, encodeFrame } from "./chat-router";
import {
  markSessionArchived,
  setSessionStatus,
  touchSession,
  setSessionTitle,
  SOCKET_HEADERS,
  setSessionSnapshot,
} from "./service";
import { Transcript } from "./transcript";

const log = logger("arch-sessions/session-object");

type Phase = "planning" | "building" | "waiting" | "deployed" | "failed" | "closed";

/**
 * Who is behind a socket and, once they subscribed, the id their frames are
 * sent under; kept on the socket so it survives hibernation.
 */
interface Attachment {
  principal: Principal;
  iteratorId?: string;
}

const TITLE_LENGTH = 80;

/**
 * One build session: the chat sockets, the transcript, the planner, and the
 * bridge to the builder. Named by the session id. The sockets carry the chat
 * contract (`sessionChatContract`): a subscription replays the transcript and
 * then receives every frame the object broadcasts.
 */
export class BuildSessionObject extends DurableObject<SessionsEnv> {
  private readonly transcript: Transcript;
  private readonly chat = chatHandler({
    subscribed: (ws, iteratorId, after) => this.subscribed(ws, iteratorId, after),
    received: (ws, text) => this.received(ws, text),
  });
  // User messages are handled one at a time: the planner must see its own
  // previous answer before it reads the next question.
  private queue: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: SessionsEnv) {
    super(ctx, env);
    this.transcript = new Transcript(ctx.storage.sql);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** The upgrade request the router forwarded, with the identity in headers. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const sessionId = request.headers.get(SOCKET_HEADERS.sessionId);
    if (sessionId) this.transcript.set("sessionId", sessionId);
    const principal = readPrincipal(request.headers);
    if (!principal) return new Response("Missing identity", { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ principal } satisfies Attachment);
    log.info("socket accepted", {
      sessionId: this.sessionId(),
      userId: principal.userId,
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  /** A chat procedure call; oRPC decodes it and answers on the same socket. */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.chat.message(ws, message, { context: { ws } });
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    log.debug("socket closed", { sessionId: this.sessionId(), code });
    this.chat.close(ws);
    try {
      ws.close(code, reason);
    } catch {
      // Already closed by the peer.
    }
  }

  webSocketError(_ws: WebSocket, error: unknown): void {
    log.warn("socket error", { err: error, sessionId: this.sessionId() });
  }

  // ── RPC from the BuilderObject ────────────────────────────────────────────

  /** A builder message for the chat. */
  async relay(frame: { role: "builder"; text: string }): Promise<void> {
    this.post(frame.role, frame.text);
  }

  /** Archived by hand: the chat stays readable and answers nothing but the closed notice. */
  async archive(): Promise<void> {
    this.setPhase("closed");
  }

  /** Cleared: every message and state entry is gone; open sockets are closed. */
  async clear(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, "cleared");
      } catch {
        // Already gone.
      }
    }
    this.transcript.wipe();
    await this.ctx.storage.deleteAlarm();
    log.info("session cleared", { sessionId: this.sessionId() });
  }

  /** What the planner or builder is doing, shown in the chat as it happens. */
  async progress(text: string, kind?: "log"): Promise<void> {
    this.broadcast(this.transcript.appendProgress(text, kind));
  }

  /** The builder's container snapshot handle, kept on the session row. */
  async builderSnapshot(snapshot: ContainerSnapshot | null): Promise<void> {
    await setSessionSnapshot(this.sessionId(), snapshot);
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

  // ── Chat procedures ───────────────────────────────────────────────────────

  /** `subscribe`: the stored frames from after `after`, the sync marker, then live frames. */
  private subscribed(ws: WebSocket, iteratorId: string, after: string | undefined): void {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    ws.serializeAttachment({ ...attachment, iteratorId } satisfies Attachment);
    for (const frame of this.transcript.listAfter(after ?? null)) this.send(ws, frame);
    this.send(ws, { type: "synced" });
  }

  /** `send`: one user message at a time, in order. */
  private async received(ws: WebSocket, text: string): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment)
      throw new ORPCError("UNAUTHORIZED", { message: "Unknown connection" });
    this.queue = this.queue
      .then(() => this.handleUserMessage(attachment.principal, text))
      .catch((err) => {
        log.error("user message failed", { err, sessionId: this.sessionId() });
        this.broadcast(errorFrame("Something went wrong handling your message"));
      });
    await this.queue;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async handleUserMessage(who: Principal, text: string): Promise<void> {
    const sessionId = this.sessionId();
    this.broadcast(this.transcript.append("user", text));
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
      this.broadcast(errorFrame(`The planner is not available: ${messageOf(err)}`));
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
        this.broadcast(errorFrame(`The build could not start: ${messageOf(err)}`));
      }
    }
  }

  private async startBuild(who: Principal, planText: string): Promise<void> {
    const sessionId = this.sessionId();
    const title = this.transcript.get<string>("title") ?? "Untitled change";
    const request = this.transcript.firstUserMessage() ?? title;
    const branch = await createBranch(who, {
      buildSessionId: sessionId,
      name: this.transcript.get<string>("branchName") ?? title,
      baseCommit: await mainHead(),
    });
    this.transcript.set("branchId", branch.id);
    this.setPhase("building");
    await setSessionStatus(sessionId, "building");
    const job = await buildJob({ sessionId, branch, request, plan: planText });
    await this.env.BUILDERS.getByName(sessionId).startBuild(job);
    log.info("build started", { sessionId, branchId: branch.id });
    this.post("planner", BUILD_STARTED_MESSAGE.replace("{title}", title));
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
  }

  /** Stores a server message and sends it to everyone connected. */
  private post(role: Exclude<ChatRole, "user">, text: string): void {
    this.broadcast(this.transcript.append(role, text));
    void touchSession(this.sessionId()).catch((err: unknown) =>
      log.warn("touch failed", { err }),
    );
  }

  private broadcast(frame: ServerFrame): void {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, frame);
  }

  /** To one socket's subscription; a socket that has not subscribed yet gets nothing. */
  private send(ws: WebSocket, frame: ServerFrame): void {
    const iteratorId = (ws.deserializeAttachment() as Attachment | null)?.iteratorId;
    if (!iteratorId) return;
    try {
      ws.send(encodeFrame(iteratorId, frame));
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

function errorFrame(text: string): ChatFrame {
  return { type: "error", id: crypto.randomUUID(), ts: Date.now(), text };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
