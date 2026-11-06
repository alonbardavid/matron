import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, updatedAt } from "./columns";

/** Household-wide settings the router keeps: one row per key. */
export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Household-wide secrets (OAuth client secrets and the like): one row per key,
 * the value encrypted. Never returned to the browser, and left off the
 * assistant's readable tables.
 */
export const secretSettings = sqliteTable("secret_settings", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
