import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { MiddlewareHandler } from "hono";
import type { ApiContext } from "@backend/commons/api";
import { DomainError } from "@backend/commons/errors";
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
 * The assistant's chat socket path and everything below it, for the
 * application to mount with the conversation's id as `:id`. The chat's library
 * decides what is asked for there (the socket itself, the messages so far
 * before it connects), and the conversation's object is what answers it, so no
 * path is named here: a request the object does not know gets the object's own
 * refusal.
 */
export const conversationSocketRouter: MiddlewareHandler<{
  Variables: Pick<ApiContext, "principal" | "branch">;
}> = async (c, next) => {
  const id = c.req.param("id");
  if (c.req.method !== "GET" || !id) return next();
  const principal = c.get("principal");
  if (!principal) return c.json({ message: "Not signed in" }, 401);
  return serveConversationSocket(principal, c.get("branch"), id, c.req.raw);
};

/**
 * Answers a request on the conversation's socket path, or below it, from the
 * ask session's object, which runs the assistant. An upgrade becomes the
 * chat's WebSocket; the identity travels in headers the object trusts, since
 * only the application, behind the router's signed handoff, can reach it.
 * Anything else is what the chat asks for beside its socket (the messages so
 * far, before it connects) and is answered by the path alone. A refusal is
 * thrown; the route's error hook answers it.
 */
async function serveConversationSocket(
  principal: Principal,
  branch: string,
  sessionId: string,
  request: Request,
): Promise<Response> {
  conversationPermissions.require(principal, "chat");
  const conversation = await getConversation(principal, sessionId);
  // Its messages live on the branch it was started on; another branch's object holds nothing of it.
  if (conversation.branch !== branch) {
    throw new DomainError("FORBIDDEN", "This conversation was started on another branch");
  }
  const object = await getAgentByName((env as unknown as AskEnv).ASK_SESSIONS, sessionId);
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return object.fetch(new Request(request.url));
  }
  const headers = new Headers(request.headers);
  headers.set(ASK_SOCKET_HEADERS.userId, principal.userId);
  headers.set(ASK_SOCKET_HEADERS.userName, principal.name);
  headers.set(ASK_SOCKET_HEADERS.userEmail, principal.email);
  headers.set(ASK_SOCKET_HEADERS.userRole, principal.role);
  headers.set(ASK_SOCKET_HEADERS.branch, branch);
  log.info("ask socket opened", { askSessionId: sessionId, userId: principal.userId });
  return object.fetch(new Request(request, { headers }));
}
