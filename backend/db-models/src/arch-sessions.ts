import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./arch-auth";
import { createdAt, timestamp, updatedAt } from "./columns";

export const BUILD_SESSION_STATUSES = [
  "planning",
  "building",
  "waiting",
  "deployed",
  "failed",
  "closed",
  "merged",
  "abandoned",
] as const;
export type BuildSessionStatus = (typeof BUILD_SESSION_STATUSES)[number];

// The transcript lives in the session's Durable Object, not here.
export const buildSessions = sqliteTable(
  "build_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    status: text("status", { enum: BUILD_SESSION_STATUSES })
      .default("planning")
      .notNull(),
    // The container snapshot handle, JSON, once the builder has paused or finished.
    snapshot: text("snapshot"),
    // Set when the session was archived: hidden by default, viewable, never continued.
    archivedAt: timestamp("archived_at"),
    // Set when an archived session's transcript and builder state were wiped: the row is all that is left.
    clearedAt: timestamp("cleared_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("build_sessions_user_id_idx").on(table.userId)],
);
