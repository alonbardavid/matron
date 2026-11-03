import { sql } from "drizzle-orm";
import { integer } from "drizzle-orm/sqlite-core";

export function timestamp(name: string) {
  return integer(name, { mode: "timestamp_ms" });
}

const NOW = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export function createdAt() {
  return timestamp("created_at").default(NOW).notNull();
}

export function updatedAt() {
  return timestamp("updated_at").default(NOW).notNull();
}
