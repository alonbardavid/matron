import {
  archiveConversation,
  createConversation,
  listConversations,
  renameConversation,
} from "@backend/ask/conversations";
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
