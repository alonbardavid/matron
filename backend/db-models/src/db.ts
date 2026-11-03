import { env } from "cloudflare:workers";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

export type Db = DrizzleD1Database;

/** The D1 database bound as DB: production's on main, the branch's own on a Preview. */
export function getDb(): Db {
  return drizzle((env as unknown as { DB: D1Database }).DB);
}
