import type { AgentToolRunInspection, AgentToolStoredChunk } from "agents";
import { BUILD_LINE_PART, type BuildLine } from "@shared/contract/arch/sessions";

/** A run's progress line is a transient frame the session's clients show as the run's status. */
const PROGRESS_PART = "data-agent-progress";

export type RunStatus = "running" | "completed" | "error" | "aborted";

interface RunRow {
  run_id: string;
  status: RunStatus;
  started_at: number;
  completed_at: number | null;
  summary: string | null;
  error: string | null;
  progress_json: string | null;
  [key: string]: SqlStorageValue;
}

type Listener = (chunk: AgentToolStoredChunk) => void;

const encoder = new TextEncoder();

/**
 * Each run's record and lines, in the builder's SQLite, as the session's
 * agent-tool run reads them: the record says how the run is doing and how it
 * ended, the lines are its chunks. A line is kept and handed to whoever
 * tails the run live; a progress frame is only handed on, and kept on the
 * record as the run's latest status.
 */
export class RunRecords {
  /** Who tails a run live, and how to let them go when it ends. */
  private readonly tails = new Map<
    string,
    Set<{ listen: Listener; close: () => void }>
  >();

  constructor(private readonly sql: SqlStorage) {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      summary TEXT,
      error TEXT,
      progress_json TEXT
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS run_chunks (
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    )`);
  }

  /** The run's record, started now unless it already exists. */
  open(runId: string): AgentToolRunInspection {
    this.sql.exec(
      "INSERT OR IGNORE INTO runs (run_id, status, started_at) VALUES (?, 'running', ?)",
      runId,
      Date.now(),
    );
    return inspectionOf(this.row(runId)!);
  }

  /** The run's record; null for a run this builder never saw. */
  inspect(runId: string): AgentToolRunInspection | null {
    const row = this.row(runId);
    return row ? inspectionOf(row) : null;
  }

  /** The run is over, one way or another. */
  isOver(runId: string): boolean {
    const row = this.row(runId);
    return !row || row.completed_at !== null;
  }

  /** The run's stored lines after `afterSequence`. */
  chunks(runId: string, afterSequence: number): AgentToolStoredChunk[] {
    return this.sql
      .exec<{ seq: number; body: string }>(
        "SELECT seq, body FROM run_chunks WHERE run_id = ? AND seq > ? ORDER BY seq",
        runId,
        afterSequence,
      )
      .toArray()
      .map((row) => ({ sequence: row.seq, body: row.body }));
  }

  /**
   * The run's lines, stored ones first and then live, one JSON chunk per
   * line, until the run ends.
   */
  tail(runId: string, afterSequence: number): ReadableStream<Uint8Array> {
    let closed = false;
    let last = afterSequence;
    // Lines arriving while the stored ones replay wait their turn.
    let draining = true;
    const backlog: AgentToolStoredChunk[] = [];
    let tail: { listen: Listener; close: () => void } | undefined;
    const detach = () => {
      if (tail) this.tails.get(runId)?.delete(tail);
      tail = undefined;
    };
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        const emit = (chunk: AgentToolStoredChunk) => {
          if (closed) return;
          if (chunk.unstoredId === undefined) {
            if (chunk.sequence <= last) return;
            last = chunk.sequence;
          }
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
          } catch {
            closed = true;
            detach();
          }
        };
        tail = {
          listen: (chunk) => (draining ? backlog.push(chunk) : emit(chunk)),
          close: () => {
            if (closed) return;
            closed = true;
            detach();
            try {
              controller.close();
            } catch {
              // Already closed by the reader.
            }
          },
        };
        const tails = this.tails.get(runId) ?? new Set();
        tails.add(tail);
        this.tails.set(runId, tails);
        for (const chunk of this.chunks(runId, afterSequence)) emit(chunk);
        draining = false;
        for (const chunk of backlog) emit(chunk);
        backlog.length = 0;
        if (this.isOver(runId)) tail.close();
      },
      cancel: () => {
        closed = true;
        detach();
      },
    });
  }

  /** A line of the run, kept and handed to whoever tails it. */
  line(runId: string, text: string, kind: BuildLine["kind"]): void {
    const seq = this.nextSequence(runId);
    const part: BuildLine = { text, kind, ts: Date.now() };
    const body = JSON.stringify({
      type: BUILD_LINE_PART,
      id: `${runId}:${seq}`,
      data: part,
    });
    this.sql.exec(
      "INSERT INTO run_chunks (run_id, seq, body) VALUES (?, ?, ?)",
      runId,
      seq,
      body,
    );
    this.forward(runId, { sequence: seq, body });
  }

  /** What the run is up to: shown live as its status and kept on the record, never a stored line. */
  progress(runId: string, phase: string, message: string): void {
    const snapshot = { phase, message };
    this.sql.exec(
      "UPDATE runs SET progress_json = ? WHERE run_id = ?",
      JSON.stringify({ ...snapshot, at: Date.now() }),
      runId,
    );
    const body = JSON.stringify({
      type: PROGRESS_PART,
      id: crypto.randomUUID(),
      data: snapshot,
      transient: true,
    });
    this.forward(runId, {
      sequence: this.nextSequence(runId),
      body,
      unstoredId: crypto.randomUUID(),
    });
  }

  /** The run is over: its record says how, and whoever tails it is let go. */
  end(runId: string, status: Exclude<RunStatus, "running">, text: string): void {
    const completedAt = Date.now();
    if (status === "completed") {
      this.sql.exec(
        "UPDATE runs SET status = 'completed', summary = ?, completed_at = ? WHERE run_id = ? AND completed_at IS NULL",
        text,
        completedAt,
        runId,
      );
    } else {
      this.sql.exec(
        "UPDATE runs SET status = ?, error = ?, completed_at = ? WHERE run_id = ? AND completed_at IS NULL",
        status,
        text,
        completedAt,
        runId,
      );
    }
    for (const tail of this.tails.get(runId) ?? []) tail.close();
    this.tails.delete(runId);
  }

  /** Every live tail is let go, as when the builder is cleared. */
  closeAll(): void {
    for (const tails of this.tails.values()) for (const tail of tails) tail.close();
    this.tails.clear();
  }

  private row(runId: string): RunRow | null {
    return (
      this.sql.exec<RunRow>("SELECT * FROM runs WHERE run_id = ?", runId).toArray()[0] ??
      null
    );
  }

  private nextSequence(runId: string): number {
    const row = this.sql
      .exec<{ next: number }>(
        "SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM run_chunks WHERE run_id = ?",
        runId,
      )
      .toArray()[0];
    return row?.next ?? 0;
  }

  private forward(runId: string, chunk: AgentToolStoredChunk): void {
    for (const tail of this.tails.get(runId) ?? []) tail.listen(chunk);
  }
}

function inspectionOf(row: RunRow): AgentToolRunInspection {
  let progress: AgentToolRunInspection["progress"];
  if (row.progress_json) {
    try {
      progress = JSON.parse(row.progress_json) as AgentToolRunInspection["progress"];
    } catch {
      progress = undefined;
    }
  }
  return {
    runId: row.run_id,
    status: row.status,
    startedAt: row.started_at,
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
    ...(row.summary !== null ? { summary: row.summary } : {}),
    ...(row.error !== null ? { error: row.error } : {}),
    ...(progress ? { progress } : {}),
  };
}
