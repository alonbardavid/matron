import { desc, eq } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { askSession } from "@backend/db-models/ask";
import { getDb } from "@backend/db-models/db";
import type { Conversation } from "@shared/contract/app/conversations";
import { conversationPermissions } from "./permissions";

const log = logger("ask/conversations");

type Row = typeof askSession.$inferSelect;

/** The caller's conversations with the assistant, newest first. */
export async function listConversations(principal: Principal): Promise<Conversation[]> {
  conversationPermissions.require(principal, "view");
  const rows = await getDb()
    .select()
    .from(askSession)
    .where(eq(askSession.userId, principal.userId))
    .orderBy(desc(askSession.updatedAt));
  return rows.map(toSession);
}

/** A conversation on the branch it is started from; it is continued only there. */
export async function createConversation(
  principal: Principal,
  branch: string,
): Promise<Conversation> {
  conversationPermissions.require(principal, "create");
  const [row] = await getDb()
    .insert(askSession)
    .values({ id: newEntityId("ASK_SESSION"), userId: principal.userId, branch })
    .returning();
  log.info("ask session created", {
    askSessionId: row!.id,
    userId: principal.userId,
    branch,
  });
  return toSession(row!);
}

/** The session, when it is the caller's. */
export async function getConversation(
  principal: Principal,
  id: string,
): Promise<Conversation> {
  conversationPermissions.require(principal, "view");
  const row = await getDb().select().from(askSession).where(eq(askSession.id, id)).get();
  if (!row || row.userId !== principal.userId) {
    throw new DomainError("NOT_FOUND", "Conversation not found");
  }
  return toSession(row);
}

export async function renameConversation(
  principal: Principal,
  id: string,
  title: string,
): Promise<Conversation> {
  conversationPermissions.require(principal, "rename");
  await getConversation(principal, id);
  const [row] = await getDb()
    .update(askSession)
    .set({ title, updatedAt: new Date() })
    .where(eq(askSession.id, id))
    .returning();
  return toSession(row!);
}

/** Marks activity: the list orders conversations by it. Sets the title from the first message. */
export async function touchConversation(
  id: string,
  firstMessage?: string,
): Promise<void> {
  const row = await getDb().select().from(askSession).where(eq(askSession.id, id)).get();
  if (!row) return;
  await getDb()
    .update(askSession)
    .set({
      updatedAt: new Date(),
      ...(row.title === null && firstMessage
        ? { title: firstMessage.replace(/\s+/g, " ").trim().slice(0, 80) }
        : {}),
    })
    .where(eq(askSession.id, id));
}

export async function archiveConversation(
  principal: Principal,
  id: string,
): Promise<Conversation> {
  conversationPermissions.require(principal, "archive");
  await getConversation(principal, id);
  const [row] = await getDb()
    .update(askSession)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(askSession.id, id))
    .returning();
  log.info("ask session archived", { askSessionId: id, userId: principal.userId });
  return toSession(row!);
}

function toSession(row: Row): Conversation {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    branch: row.branch,
    archivedAt: row.archivedAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}
