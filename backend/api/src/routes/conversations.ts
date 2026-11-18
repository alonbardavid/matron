import type { Handler } from "hono";
import {
  archiveConversation,
  createConversation,
  listConversations,
  renameConversation,
} from "@backend/ask/conversations";
import { proxyToConversation } from "@backend/ask/proxy";
import type { ApiContext } from "@backend/commons/api";
import { app } from "../implementer";

export const conversations = app.conversations.router({
  list: app.conversations.list.handler(({ context }) =>
    listConversations(context.principal),
  ),
  create: app.conversations.create.handler(({ context }) =>
    createConversation(context.principal, context.branch),
  ),
  rename: app.conversations.rename.handler(({ context, input }) =>
    renameConversation(context.principal, input.id, input.title),
  ),
  archive: app.conversations.archive.handler(({ context, input }) =>
    archiveConversation(context.principal, input.id),
  ),
});

/**
 * The assistant's chat socket path and everything below it, for the
 * application to mount with the conversation's id as `:id`. No path is named
 * here: the chat's library decides what is asked for there, and the
 * conversation's object answers it.
 */
export const askProxyRoute: Handler<{ Variables: ApiContext }, "/:id"> = (c) => {
  const principal = c.get("principal");
  if (!principal) return c.json({ message: "Not signed in" }, 401);
  return proxyToConversation(principal, c.get("branch"), c.req.param("id"), c.req.raw);
};
