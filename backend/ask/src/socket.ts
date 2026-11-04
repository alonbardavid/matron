import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { DOMAIN_ERROR_STATUS, DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { ASK_SOCKET_HEADERS, type AskSessionObject } from "./ask-object";
import { getConversation } from "./conversations";
import { conversationPermissions } from "./permissions";

const log = logger("ask/socket");

interface AskEnv {
  ASK_SESSIONS: DurableObjectNamespace<AskSessionObject>;
}

/**
 * Upgrades the request to the ask session's object, which runs the assistant.
 * The identity travels in headers the object trusts: only the application,
 * behind the router's signed handoff, can reach it.
 */
export async function openAskSocket(
  principal: Principal,
  branch: string,
  sessionId: string,
  request: Request,
): Promise<Response> {
  try {
    conversationPermissions.require(principal, "chat");
    await getConversation(principal, sessionId);
  } catch (err) {
    if (err instanceof DomainError) {
      return new Response(err.message, { status: DOMAIN_ERROR_STATUS[err.code] });
    }
    throw err;
  }
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }
  const headers = new Headers(request.headers);
  headers.set(ASK_SOCKET_HEADERS.userId, principal.userId);
  headers.set(ASK_SOCKET_HEADERS.userName, principal.name);
  headers.set(ASK_SOCKET_HEADERS.userEmail, principal.email);
  headers.set(ASK_SOCKET_HEADERS.userRole, principal.role);
  headers.set(ASK_SOCKET_HEADERS.branch, branch);
  log.info("ask socket opened", { askSessionId: sessionId, userId: principal.userId });
  const object = await getAgentByName((env as unknown as AskEnv).ASK_SESSIONS, sessionId);
  return object.fetch(new Request(request, { headers }));
}
