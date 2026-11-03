import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  BuilderEvent,
  BuilderEventBody,
  BuilderStatus,
  StatusDetail,
} from "./types.js";

/**
 * The builder's event log: kept in memory for the socket to replay, pushed to
 * listeners as it grows, and appended to a jsonl file so a restored filesystem
 * snapshot keeps it. `seq` continues from the last persisted event, so it is
 * monotonic across container restarts.
 */
export class EventLog {
  private events: BuilderEvent[] = [];
  private seq = 0;
  private current: BuilderStatus = "idle";
  private listeners = new Set<(event: BuilderEvent) => void>();

  constructor(private readonly file: string) {
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as BuilderEvent;
          if (typeof event.seq !== "number") continue;
          this.events.push(event);
          this.seq = Math.max(this.seq, event.seq);
          if (event.type === "status") this.current = event.status;
        } catch {
          // A torn last line from an interrupted write; skip it.
        }
      }
    }
  }

  get status(): BuilderStatus {
    return this.current;
  }

  get lastSeq(): number {
    return this.seq;
  }

  emit(body: BuilderEventBody): BuilderEvent {
    const event: BuilderEvent = { seq: ++this.seq, ts: Date.now(), ...body };
    this.events.push(event);
    if (body.type === "status") this.current = body.status;
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(event) + "\n");
    for (const listener of this.listeners) listener(event);
    return event;
  }

  /** Called with every event emitted from now on; returns the unsubscribe. */
  subscribe(listener: (event: BuilderEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  message(text: string): BuilderEvent {
    return this.emit({ type: "message", text });
  }

  log(text: string): BuilderEvent {
    return this.emit({ type: "log", text });
  }

  progress(text: string): BuilderEvent {
    return this.emit({ type: "progress", text });
  }

  setStatus(status: BuilderStatus, detail?: StatusDetail): BuilderEvent {
    return this.emit(
      detail ? { type: "status", status, detail } : { type: "status", status },
    );
  }

  /** Events with `seq` greater than `after`. */
  after(after: number): BuilderEvent[] {
    if (after <= 0) return [...this.events];
    // seq is strictly increasing, so a binary search would do; the log is small.
    return this.events.filter((event) => event.seq > after);
  }
}
