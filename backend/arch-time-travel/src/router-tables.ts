import { getTableName, type Table } from "drizzle-orm";
import {
  user,
  userAccounts,
  userSessions,
  userVerifications,
} from "@backend/db-models/arch-auth";
import { branches } from "@backend/db-models/arch-branches";
import { buildSessions } from "@backend/db-models/arch-sessions";
import { settings } from "@backend/db-models/arch-settings";

/**
 * The router's tables, parents before the tables that reference them. A
 * restore takes the household's data back in time but not these: who may sign
 * in, the build sessions and branches (whose Previews, databases and Durable
 * Objects live outside the database) and the settings stay as they are now.
 */
const ROUTER_TABLES: readonly Table[] = [
  user,
  settings,
  buildSessions,
  branches,
  userSessions,
  userAccounts,
  userVerifications,
];

/** D1 refuses a statement with more bound parameters than this. */
const MAX_PARAMETERS = 100;

type Row = Record<string, unknown>;

/** The router tables' rows at one moment, by table name. */
export interface RouterSnapshot {
  takenAt: number;
  tables: Record<string, Row[]>;
}

export async function snapshotRouterTables(db: D1Database): Promise<RouterSnapshot> {
  const tables: Record<string, Row[]> = {};
  for (const table of ROUTER_TABLES) {
    const name = getTableName(table);
    const { results } = await db.prepare(`SELECT * FROM ${quote(name)}`).all<Row>();
    tables[name] = results;
  }
  return { takenAt: Date.now(), tables };
}

/**
 * Puts the snapshot's rows back, in one transaction. Rows the restore brought
 * back that are gone from the snapshot are deleted first, children before
 * parents, so a unique column (an email, a branch name) is free again; then
 * every snapshot row is upserted by id. Nothing in a router table is deleted
 * and inserted again, so no cascade reaches the household's own tables. Only
 * the columns the restored table still has are written: a column added after
 * the restore point comes back with the migration that adds it.
 */
export async function replaceRouterTables(
  db: D1Database,
  snapshot: RouterSnapshot,
): Promise<{ rows: number }> {
  const names = ROUTER_TABLES.map((table) => getTableName(table));
  const columnsOf = new Map<string, string[]>();
  for (const name of names) columnsOf.set(name, await tableColumns(db, name));

  const statements: D1PreparedStatement[] = [];
  for (const name of [...names].reverse()) {
    if (!columnsOf.get(name)?.length) continue;
    const ids = (snapshot.tables[name] ?? []).map((row) => row.id);
    statements.push(
      db
        .prepare(
          `DELETE FROM ${quote(name)} WHERE id NOT IN (SELECT value FROM json_each(?))`,
        )
        .bind(JSON.stringify(ids)),
    );
  }
  let rows = 0;
  for (const name of names) {
    const present = new Set(columnsOf.get(name) ?? []);
    const saved = snapshot.tables[name] ?? [];
    if (present.size === 0 || saved.length === 0) continue;
    const columns = Object.keys(saved[0]!).filter((column) => present.has(column));
    if (!columns.includes("id")) continue;
    const perStatement = Math.max(1, Math.floor(MAX_PARAMETERS / columns.length));
    const updates = columns
      .filter((column) => column !== "id")
      .map((column) => `${quote(column)} = excluded.${quote(column)}`);
    const conflict = updates.length
      ? `ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}`
      : "ON CONFLICT (id) DO NOTHING";
    for (let start = 0; start < saved.length; start += perStatement) {
      const chunk = saved.slice(start, start + perStatement);
      const tuple = `(${columns.map(() => "?").join(", ")})`;
      statements.push(
        db
          .prepare(
            `INSERT INTO ${quote(name)} (${columns.map(quote).join(", ")}) VALUES ${chunk
              .map(() => tuple)
              .join(", ")} ${conflict}`,
          )
          .bind(...chunk.flatMap((row) => columns.map((column) => row[column] ?? null))),
      );
      rows += chunk.length;
    }
  }
  await db.batch(statements);
  return { rows };
}

async function tableColumns(db: D1Database, name: string): Promise<string[]> {
  const { results } = await db
    .prepare(`PRAGMA table_info(${quote(name)})`)
    .all<{ name: string }>();
  return results.map((row) => row.name);
}

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
