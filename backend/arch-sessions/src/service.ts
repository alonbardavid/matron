import { getAgentByName } from "agents";
import { desc, eq } from "drizzle-orm";
import { branchPermissions } from "@backend/arch-branches/permissions";
import { branchForSession, type BranchRow } from "@backend/arch-branches/service";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { getDb } from "@backend/db-models/db";
import { buildSessions, type BuildSessionStatus } from "@backend/db-models/arch-sessions";
import { canArchiveSession, canClearSession } from "./archive";
import type { BuildSession } from "@shared/contract/arch/sessions";
import { sessionsEnv } from "./env";

const log = logger("arch-sessions/service");

/** Headers the router puts on the upgrade request it forwards to the session's Durable Object. */
export const SOCKET_HEADERS = {
  sessionId: "x-session-id",
  userId: "x-user-id",
  userName: "x-user-name",
  userEmail: "x-user-email",
  userRole: "x-user-role",
} as const;

export type SessionRow = typeof buildSessions.$inferSelect;

function authorize(principal: Principal): void {
  if (!branchPermissions.can(principal.role, "create")) {
    throw new DomainError("FORBIDDEN", "You cannot start build sessions");
  }
}

/** The caller's sessions, newest first; the owner sees everyone's. */
export async function listSessions(principal: Principal): Promise<BuildSession[]> {
  authorize(principal);
  const query = getDb().select().from(buildSessions);
  const rows =
    principal.role === "owner"
      ? await query.orderBy(desc(buildSessions.updatedAt))
      : await query
          .where(eq(buildSessions.userId, principal.userId))
          .orderBy(desc(buildSessions.updatedAt));
  const out: BuildSession[] = [];
  for (const row of rows) {
    out.push(toSession(row, await branchForSession(row.id)));
  }
  return out;
}

/**
 * Archives a session by hand: allowed once nothing runs for it. Its chat is
 * closed so it can be read but not continued.
 */
export async function archiveSession(
  principal: Principal,
  sessionId: string,
): Promise<BuildSession> {
  authorize(principal);
  const row = await getSessionRow(sessionId);
  if (row.userId !== principal.userId && principal.role !== "owner") {
    throw new DomainError("FORBIDDEN", "This is not your build session");
  }
  const branch = await branchForSession(sessionId);
  if (!canArchiveSession(row, branch)) {
    throw new DomainError(
      "CONFLICT",
      "A session with a deployed branch cannot be archived",
    );
  }
  await markSessionArchived(sessionId);
  await sessionsEnv().BUILD_SESSIONS.getByName(sessionId).archive();
  log.info("build session archived", { sessionId, userId: principal.userId });
  return toSession(await getSessionRow(sessionId), branch);
}

/**
 * Wipes what an archived session still holds: the chat transcript and the
 * builder's state. The row stays, so lists and branches still name it.
 */
export async function clearSession(
  principal: Principal,
  sessionId: string,
): Promise<BuildSession> {
  authorize(principal);
  const row = await getSessionRow(sessionId);
  if (row.userId !== principal.userId && principal.role !== "owner") {
    throw new DomainError("FORBIDDEN", "This is not your build session");
  }
  if (!canClearSession(row)) {
    throw new DomainError("CONFLICT", "Only an archived session can be cleared, once");
  }
  const env = sessionsEnv();
  await env.BUILDERS.getByName(sessionId).clear();
  await env.BUILD_SESSIONS.getByName(sessionId).clear();
  await getDb()
    .update(buildSessions)
    .set({ clearedAt: new Date(), snapshot: null, updatedAt: new Date() })
    .where(eq(buildSessions.id, sessionId));
  log.info("build session cleared", { sessionId, userId: principal.userId });
  return toSession(await getSessionRow(sessionId), await branchForSession(sessionId));
}

export async function markSessionArchived(sessionId: string): Promise<void> {
  await getDb()
    .update(buildSessions)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(buildSessions.id, sessionId));
}

export async function createSession(principal: Principal): Promise<BuildSession> {
  authorize(principal);
  const [row] = await getDb()
    .insert(buildSessions)
    .values({
      id: newEntityId("BUILD_SESSION"),
      userId: principal.userId,
      status: "planning",
    })
    .returning();
  log.info("build session created", { sessionId: row!.id, userId: principal.userId });
  return toSession(row!, null);
}

/**
 * Upgrades the request to a WebSocket served by the session's Durable Object,
 * which replays the transcript on it and then streams every new frame. The
 * identity travels in headers the Durable Object trusts: only the router can
 * reach it. A refusal is thrown; the route's error hook answers it.
 */
export async function openSessionSocket(
  principal: Principal,
  sessionId: string,
  request: Request,
): Promise<Response> {
  authorize(principal);
  const row = await getSessionRow(sessionId);
  if (row.userId !== principal.userId && principal.role !== "owner") {
    throw new DomainError("FORBIDDEN", "This is not your build session");
  }
  if (row.clearedAt) throw new DomainError("CONFLICT", "This session was cleared");
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }
  const headers = new Headers(request.headers);
  headers.set(SOCKET_HEADERS.sessionId, sessionId);
  headers.set(SOCKET_HEADERS.userId, principal.userId);
  headers.set(SOCKET_HEADERS.userName, principal.name);
  headers.set(SOCKET_HEADERS.userEmail, principal.email);
  headers.set(SOCKET_HEADERS.userRole, principal.role);
  log.info("build session socket opened", { sessionId, userId: principal.userId });
  const buildSession = await getAgentByName(sessionsEnv().BUILD_SESSIONS, sessionId);
  return buildSession.fetch(new Request(request, { headers }));
}

export async function getSessionRow(sessionId: string): Promise<SessionRow> {
  const [row] = await getDb()
    .select()
    .from(buildSessions)
    .where(eq(buildSessions.id, sessionId));
  if (!row) throw new DomainError("NOT_FOUND", "Build session not found");
  return row;
}

export async function setSessionStatus(
  sessionId: string,
  status: BuildSessionStatus,
): Promise<void> {
  await getDb()
    .update(buildSessions)
    .set({ status, updatedAt: new Date() })
    .where(eq(buildSessions.id, sessionId));
  log.info("build session status changed", { sessionId, status });
}

/** Marks activity: the list orders sessions by it. */
export async function touchSession(sessionId: string): Promise<void> {
  await getDb()
    .update(buildSessions)
    .set({ updatedAt: new Date() })
    .where(eq(buildSessions.id, sessionId));
}

export async function setSessionTitle(sessionId: string, title: string): Promise<void> {
  await getDb()
    .update(buildSessions)
    .set({ title, updatedAt: new Date() })
    .where(eq(buildSessions.id, sessionId));
}

/** The container snapshot handle (JSON) or null once it was dropped. */
export async function setSessionSnapshot(
  sessionId: string,
  snapshot: unknown | null,
): Promise<void> {
  await getDb()
    .update(buildSessions)
    .set({
      snapshot: snapshot === null ? null : JSON.stringify(snapshot),
      updatedAt: new Date(),
    })
    .where(eq(buildSessions.id, sessionId));
  log.info("build session snapshot stored", { sessionId, present: snapshot !== null });
}

function toSession(row: SessionRow, branch: BranchRow | null): BuildSession {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    status: row.status,
    branchId: branch?.id ?? null,
    archivedAt: row.archivedAt?.getTime() ?? null,
    clearedAt: row.clearedAt?.getTime() ?? null,
    canArchive: canArchiveSession(row, branch),
    canClear: canClearSession(row),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}
