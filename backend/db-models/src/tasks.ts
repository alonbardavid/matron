import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, timestamp, updatedAt } from "./columns";

export const task = sqliteTable("task", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  creatorId: text("creator_id").notNull(),
  /** A calendar day, `YYYY-MM-DD`. */
  dueDate: text("due_date"),
  completedAt: timestamp("completed_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const taskShare = sqliteTable(
  "task_share",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    userId: text("user_id").notNull(),
    assigned: integer("assigned", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("task_share_task_user").on(table.taskId, table.userId)],
);
