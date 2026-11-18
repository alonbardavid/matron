import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { SharePermission } from "./calendar";
import { createdAt, timestamp, updatedAt } from "./columns";

/** A list of items, shared as a whole. */
export const list = sqliteTable("list", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** `#rrggbb`. */
  color: text("color").notNull(),
  creatorId: text("creator_id").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Who a list is shared with, and what each may do with it. */
export const listShare = sqliteTable(
  "list_share",
  {
    id: text("id").primaryKey(),
    listId: text("list_id").notNull(),
    userId: text("user_id").notNull(),
    /** Viewing it is always among them. */
    permissions: text("permissions", { mode: "json" })
      .$type<SharePermission[]>()
      .notNull()
      .default(["view"]),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("list_share_list_user").on(table.listId, table.userId)],
);

/** An item on a list, at the top or under another, at `position` among those beside it. */
export const listItem = sqliteTable("list_item", {
  id: text("id").primaryKey(),
  listId: text("list_id").notNull(),
  parentId: text("parent_id"),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  creatorId: text("creator_id").notNull(),
  /** A calendar day, `YYYY-MM-DD`. */
  dueDate: text("due_date"),
  completedAt: timestamp("completed_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Who an item is assigned to. */
export const listItemAssignee = sqliteTable(
  "list_item_assignee",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("list_item_assignee_item_user").on(table.itemId, table.userId)],
);
