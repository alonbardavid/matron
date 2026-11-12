import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt } from "./columns";

/** Who may see a file: everyone in the household, or only the member who uploaded it. */
export const FILE_VISIBILITIES = ["household", "private"] as const;
export type FileVisibility = (typeof FILE_VISIBILITIES)[number];

/**
 * An uploaded file: its bytes live in the bucket under `storageKey`, the row
 * says what they are and who may see them. The key starts with the branch that wrote it.
 */
export const file = sqliteTable("file", {
  id: text("id").primaryKey(),
  storageKey: text("storage_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  /** Who uploaded it. */
  userId: text("user_id").notNull(),
  visibility: text("visibility", { enum: FILE_VISIBILITIES }).notNull(),
  createdAt: createdAt(),
});
