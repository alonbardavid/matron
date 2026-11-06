/**
 * The assistant may read the database, not write it, and only the tables the
 * user may see. D1 has no authorizer, so the statement is checked here: one
 * SELECT, no statement that changes anything, and every table it names on an
 * allow-list for the user's role. Nothing fancy; the prompt says the same.
 */

/**
 * The application's tables, readable by every member. `google_calendar_connection`
 * (members' OAuth tokens) and `secret_settings` are left off on purpose: no role reads them.
 */
export const APP_TABLES = [
  "task",
  "task_share",
  "calendar",
  "calendar_share",
  "calendar_event",
  "calendar_event_share",
  "ask_session",
] as const;

/** The router's tables, readable by owners and admins only; `user` is open to everyone. */
export const ARCH_TABLES = [
  "user",
  "user_sessions",
  "user_accounts",
  "user_verifications",
  "build_sessions",
  "branches",
  "settings",
  "d1_migrations",
] as const;

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|trigger|begin|commit|rollback|savepoint|release|analyze|load_extension|writefile|readfile)\b/i;

export interface GuardOptions {
  /** Whether the router's tables may be read too (the database.read_router permission). */
  routerTables: boolean;
}

/** The tables a role may read. */
export function allowedTables(options: GuardOptions): Set<string> {
  const tables = new Set<string>([...APP_TABLES, "user"]);
  if (options.routerTables) for (const table of ARCH_TABLES) tables.add(table);
  return tables;
}

/** Returns the statement to run, or throws with the reason it may not run. */
export function guardReadOnlySql(sql: string, options: GuardOptions): string {
  const text = stripComments(sql).trim().replace(/;\s*$/, "");
  if (!text) throw new Error("The query is empty.");
  if (text.includes(";")) throw new Error("One statement at a time.");
  if (!/^(select|with)\b/i.test(text)) throw new Error("Only SELECT queries may run.");
  const hit = FORBIDDEN.exec(text);
  if (hit) throw new Error(`"${hit[1]}" is not allowed in a read-only query.`);
  const allowed = allowedTables(options);
  for (const table of referencedTables(text)) {
    if (!allowed.has(table)) throw new Error(`Table "${table}" is not available to you.`);
  }
  return text;
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Identifiers after FROM, JOIN, INTO and UPDATE, minus the CTE names the
 * statement defines itself. A subquery in those positions names no table.
 */
export function referencedTables(sql: string): string[] {
  const ctes = new Set<string>();
  for (const match of sql.matchAll(/\b(?:with|,)\s+("?[a-zA-Z_][\w]*"?)\s+as\s*\(/gi)) {
    ctes.add(unquote(match[1]!));
  }
  const tables = new Set<string>();
  for (const match of sql.matchAll(/\b(?:from|join)\s+("?[a-zA-Z_][\w.]*"?)/gi)) {
    const name = unquote(match[1]!)
      .replace(/^main\./i, "")
      .toLowerCase();
    if (!ctes.has(name)) tables.add(name);
  }
  // Tables listed after FROM with commas: FROM a, b.
  for (const match of sql.matchAll(
    /\bfrom\s+([^()]+?)(?=\bwhere\b|\bgroup\b|\border\b|\blimit\b|\bjoin\b|$)/gi,
  )) {
    for (const part of match[1]!.split(",")) {
      const name = unquote(part.trim().split(/\s+/)[0] ?? "").toLowerCase();
      if (name && /^[a-z_][\w]*$/.test(name) && !ctes.has(name)) tables.add(name);
    }
  }
  return [...tables];
}

function unquote(name: string): string {
  return name.replace(/^"|"$/g, "").toLowerCase();
}
