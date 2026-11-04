import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, timestamp, updatedAt } from "./columns";

/** A conversation with the household assistant; its messages live in its Durable Object. */
export const askSession = sqliteTable("ask_session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title"),
  /** Set once archived: readable, never continued. */
  archivedAt: timestamp("archived_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
