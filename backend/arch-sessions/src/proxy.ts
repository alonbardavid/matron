import { getAgentByName } from "agents";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { sessionsEnv } from "./env";
import { requireOpenSession, SOCKET_HEADERS } from "./service";

const log = logger("arch-sessions/proxy");

/**
 * Passes a request on to the session's Durable Object, which answers it: the
 * chat's WebSocket, on which the object replays the transcript and then
 * streams every new frame, and whatever the chat asks for beside it (the
 * messages so far, before it connects). The identity travels in headers the
 * Durable Object trusts: only the router can reach it. A refusal is thrown;
 * the route's error hook answers it.
 */
export async function proxyToBuildSession(
  principal: Principal,
  sessionId: string,
  request: Request,
): Promise<Response> {
  await requireOpenSession(principal, sessionId);
  const headers = new Headers(request.headers);
  headers.set(SOCKET_HEADERS.sessionId, sessionId);
  headers.set(SOCKET_HEADERS.userId, principal.userId);
  headers.set(SOCKET_HEADERS.userName, principal.name);
  headers.set(SOCKET_HEADERS.userEmail, principal.email);
  headers.set(SOCKET_HEADERS.userRole, principal.role);
  log.info("request passed to the build session", {
    sessionId,
    userId: principal.userId,
  });
  const buildSession = await getAgentByName(sessionsEnv().BUILD_SESSIONS, sessionId);
  return buildSession.fetch(new Request(request, { headers }));
}
