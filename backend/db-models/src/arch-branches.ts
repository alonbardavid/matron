import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./arch-auth";
import { createdAt, timestamp, updatedAt } from "./columns";
import { buildSessions } from "./arch-sessions";

export const BRANCH_STATUSES = [
  "deploying",
  "ready",
  "merging",
  "merged",
  "abandoned",
] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

/** What a branch is for: a change a member asked for, or the upstream repository's commits merged in. */
export const BRANCH_TYPES = ["session-request", "upstream-pull"] as const;
export type BranchType = (typeof BRANCH_TYPES)[number];

// A merged or abandoned branch is archived: the row stays, with its Preview and
// database gone, so the history can still be viewed.
export const branches = sqliteTable(
  "branches",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    previewName: text("preview_name").notNull().unique(),
    previewUrl: text("preview_url"),
    // The branch's own D1 database.
    databaseId: text("database_id"),
    databaseName: text("database_name"),
    buildSessionId: text("build_session_id")
      .notNull()
      .references(() => buildSessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Main's head when the branch was cut; merge compares it with main's head.
    baseCommit: text("base_commit").notNull(),
    headCommit: text("head_commit"),
    type: text("type", { enum: BRANCH_TYPES }).default("session-request").notNull(),
    status: text("status", { enum: BRANCH_STATUSES }).default("deploying").notNull(),
    archivedAt: timestamp("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("branches_user_id_idx").on(table.userId)],
);
