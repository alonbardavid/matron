import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { ASK_SOCKET_HEADERS, type AskSessionObject } from "./ask-object";
import { getConversation } from "./conversations";
import { conversationPermissions } from "./permissions";

const log = logger("ask/proxy");

interface AskEnv {
  ASK_SESSIONS: DurableObjectNamespace<AskSessionObject>;
}

/**
 * Passes a request on to the conversation's object, which runs the assistant
 * and answers it: the chat's WebSocket, and whatever the chat asks for beside
 * it (the messages so far, before it connects). The identity travels in
 * headers the object trusts: only the application, behind the router's signed
 * handoff, can reach it. A refusal is thrown; the route's error hook answers
 * it.
 */
export async function proxyToConversation(
  principal: Principal,
  branch: string,
  conversationId: string,
  request: Request,
): Promise<Response> {
  conversationPermissions.require(principal, "chat");
  const conversation = await getConversation(principal, conversationId);
  // Its messages live on the branch it was started on; another branch's object holds nothing of it.
  if (conversation.branch !== branch) {
    throw new DomainError("FORBIDDEN", "This conversation was started on another branch");
  }
  const headers = new Headers(request.headers);
  headers.set(ASK_SOCKET_HEADERS.userId, principal.userId);
  headers.set(ASK_SOCKET_HEADERS.userName, principal.name);
  headers.set(ASK_SOCKET_HEADERS.userEmail, principal.email);
  headers.set(ASK_SOCKET_HEADERS.userRole, principal.role);
  headers.set(ASK_SOCKET_HEADERS.branch, branch);
  log.info("request passed to the conversation", {
    askSessionId: conversationId,
    userId: principal.userId,
  });
  const object = await getAgentByName(
    (env as unknown as AskEnv).ASK_SESSIONS,
    conversationId,
  );
  return object.fetch(new Request(request, { headers }));
}
