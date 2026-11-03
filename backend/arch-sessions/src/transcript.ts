import type { ChatFrame, ChatRole } from "@shared/contract/arch/sessions";

/**
 * The session's transcript and a small key/value state, both in the Durable
 * Object's SQLite. Everything here is synchronous so the constructor can call it.
 */
export class Transcript {
  constructor(private readonly sql: SqlStorage) {
    this.ensureTables();
  }

  private ensureTables(): void {
    const sql = this.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL UNIQUE,
      ts INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL
    )`);
    sql.exec(
      `CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
    // Rows are messages unless `type` says "progress"; older objects lack the column.
    const columns = sql
      .exec<{ name: string }>(`PRAGMA table_info(messages)`)
      .toArray()
      .map((row) => row.name);
    if (!columns.includes("type")) {
      sql.exec(`ALTER TABLE messages ADD COLUMN type TEXT NOT NULL DEFAULT 'message'`);
    }
  }

  /** Drops every message and state entry; the tables come back empty. */
  wipe(): void {
    this.sql.exec(`DROP TABLE IF EXISTS messages`);
    this.sql.exec(`DROP TABLE IF EXISTS state`);
    this.ensureTables();
  }

  /** Stores a new message and returns the frame to broadcast. */
  append(role: ChatRole, text: string): ChatFrame & { type: "message" } {
    const frame = {
      type: "message" as const,
      id: crypto.randomUUID(),
      ts: Date.now(),
      role,
      text,
    };
    this.insert(frame.id, frame.ts, role, text, "message");
    return frame;
  }

  /** Stores a progress line (or a run of command output) and returns the frame to broadcast. */
  appendProgress(text: string, kind?: "log"): ChatFrame & { type: "progress" } {
    const frame = {
      type: "progress" as const,
      id: crypto.randomUUID(),
      ts: Date.now(),
      text,
      ...(kind ? { kind } : {}),
    };
    this.insert(frame.id, frame.ts, "builder", text, kind ?? "progress");
    return frame;
  }

  private insert(
    id: string,
    ts: number,
    role: ChatRole,
    text: string,
    type: string,
  ): void {
    this.sql.exec(
      `INSERT INTO messages (id, seq, ts, role, text, type)
       VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM messages), ?, ?, ?, ?)`,
      id,
      ts,
      role,
      text,
      type,
    );
  }

  /** Every message and progress line after `afterId`, or all of them when it is unknown or null. */
  listAfter(afterId: string | null): ChatFrame[] {
    const rows = afterId
      ? this.sql
          .exec<MessageRow>(
            `SELECT id, ts, role, text, type FROM messages
             WHERE seq > COALESCE((SELECT seq FROM messages WHERE id = ?), 0)
             ORDER BY seq`,
            afterId,
          )
          .toArray()
      : this.sql
          .exec<MessageRow>(`SELECT id, ts, role, text, type FROM messages ORDER BY seq`)
          .toArray();
    return rows.map((row) =>
      row.type === "progress" || row.type === "log"
        ? {
            type: "progress" as const,
            id: row.id,
            ts: row.ts,
            text: row.text,
            ...(row.type === "log" ? { kind: "log" as const } : {}),
          }
        : {
            type: "message" as const,
            id: row.id,
            ts: row.ts,
            role: row.role as ChatRole,
            text: row.text,
          },
    );
  }

  /** Only user and planner turns, for the planner's context. */
  planningTurns(): { role: "user" | "planner"; text: string }[] {
    return this.sql
      .exec<MessageRow>(
        `SELECT id, ts, role, text, type FROM messages WHERE type = 'message' AND role IN ('user', 'planner') ORDER BY seq`,
      )
      .toArray()
      .map((row) => ({ role: row.role as "user" | "planner", text: row.text }));
  }

  firstUserMessage(): string | null {
    const row = this.sql
      .exec<MessageRow>(
        `SELECT id, ts, role, text, type FROM messages WHERE type = 'message' AND role = 'user' ORDER BY seq LIMIT 1`,
      )
      .toArray()[0];
    return row?.text ?? null;
  }

  get<T>(key: string): T | null {
    const row = this.sql
      .exec<{ value: string }>(`SELECT value FROM state WHERE key = ?`, key)
      .toArray()[0];
    return row ? (JSON.parse(row.value) as T) : null;
  }

  set(key: string, value: unknown): void {
    this.sql.exec(
      `INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      JSON.stringify(value),
    );
  }
}

interface MessageRow {
  id: string;
  ts: number;
  role: string;
  text: string;
  type: string;
  [key: string]: SqlStorageValue;
}
