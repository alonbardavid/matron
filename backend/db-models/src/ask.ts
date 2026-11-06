import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, timestamp, updatedAt } from "./columns";

/** A conversation with the household assistant; its messages live in its Durable Object. */
export const askSession = sqliteTable("ask_session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title"),
  /** The branch it was started on: "main" or a branch id. Continued only there. */
  branch: text("branch").notNull().default("main"),
  /** Set once archived: readable, never continued. */
  archivedAt: timestamp("archived_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
