import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, updatedAt } from "./columns";

export const TODO_STATUSES = ["unchecked", "checked"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const todo = sqliteTable("todo", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  status: text("status", { enum: TODO_STATUSES }).default("unchecked").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
