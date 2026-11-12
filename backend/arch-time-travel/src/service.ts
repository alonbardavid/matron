import { DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";
import { timeTravelEnv } from "./env";
import {
  replaceRouterTables,
  snapshotRouterTables,
  type RouterSnapshot,
} from "./router-tables";

const log = logger("arch-time-travel/service");

/**
 * Where a restore keeps the router tables while it runs, so a restore that
 * stopped halfway puts back the rows from before it rather than the restored
 * ones. `restoring` says the restore may have happened since the snapshot was
 * taken: from then on the snapshot is the only copy.
 */
export interface SnapshotStore {
  load(): Promise<{ snapshot: RouterSnapshot; restoring: boolean } | null>;
  /** Keeps `snapshot` as the only copy: the restore is about to be asked for. */
  save(snapshot: RouterSnapshot): Promise<void>;
  /** The restore was refused: the next attempt may take a fresh snapshot. */
  markNotRestoring(): Promise<void>;
  clear(): Promise<void>;
}

interface Envelope<T> {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
}

/** A call Cloudflare answered with a refusal: nothing was changed. */
class RefusedError extends Error {}

/**
 * Checks Time Travel still reaches `at` on the production database, before
 * anything is changed. Fails with a readable error when it does not.
 */
export async function checkRestorePoint(at: number): Promise<void> {
  try {
    const id = await productionDatabaseId();
    await call(`/d1/database/${id}/time_travel/bookmark?timestamp=${param(at)}`);
  } catch (err) {
    throw new DomainError(
      "CONFLICT",
      `The production database cannot be restored to ${iso(at)}: ${messageOf(err)}`,
    );
  }
}

/**
 * Restores the production database in place to `at` with D1 Time Travel and
 * puts the router tables back as they were just before (see
 * {@link replaceRouterTables}). Run again after a failure, it reuses the
 * snapshot `store` kept, so it is safe to retry.
 */
export async function restoreProductionDatabase(
  at: number,
  store: SnapshotStore,
): Promise<{ bookmark: string | null; previousBookmark: string | null }> {
  const { DB } = timeTravelEnv();
  const id = await productionDatabaseId();
  const kept = await store.load();
  let snapshot: RouterSnapshot;
  if (kept?.restoring) {
    // The database may already be restored: these rows are the only copy.
    snapshot = kept.snapshot;
    log.info("restore resumed with kept router tables", { takenAt: snapshot.takenAt });
  } else {
    snapshot = await snapshotRouterTables(DB);
    await store.save(snapshot);
  }
  let restored: { bookmark?: string; previous_bookmark?: string };
  try {
    restored = await call(
      `/d1/database/${id}/time_travel/restore?timestamp=${param(at)}`,
      {
        method: "POST",
      },
    );
  } catch (err) {
    // Refused outright: the database is untouched and the snapshot may be retaken.
    if (err instanceof RefusedError) await store.markNotRestoring();
    throw err;
  }
  log.info("production database restored", { at, bookmark: restored.bookmark ?? null });
  const { rows } = await replaceRouterTables(DB, snapshot);
  await store.clear();
  log.info("router tables kept across the restore", { rows });
  return {
    bookmark: restored.bookmark ?? null,
    previousBookmark: restored.previous_bookmark ?? null,
  };
}

async function productionDatabaseId(): Promise<string> {
  // The production database is named after the Worker.
  const name = timeTravelEnv().WORKER_NAME;
  const rows = await call<{ uuid: string; name: string }[]>(
    `/d1/database?per_page=100&name=${encodeURIComponent(name)}`,
  );
  const row = rows.find((db) => db.name === name);
  if (!row) throw new Error(`The production database ${name} was not found`);
  return row.uuid;
}

async function call<T>(path: string, options: { method?: string } = {}): Promise<T> {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId } =
    timeTravelEnv();
  if (!token || !accountId) {
    throw new RefusedError(
      "This deployment holds no Cloudflare API token: set the CLOUDFLARE_API_TOKEN secret and CLOUDFLARE_ACCOUNT_ID on the Worker.",
    );
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
    {
      method: options.method ?? "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    },
  );
  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    // Not JSON: the status tells the story.
  }
  if (!response.ok || !envelope?.success) {
    const first = envelope?.errors?.[0];
    const message = first
      ? `${first.message} (code ${first.code})`
      : `Cloudflare answered ${response.status}`;
    // A JSON refusal is an answer: the call did nothing. Anything else may have.
    if (envelope) throw new RefusedError(message);
    throw new Error(message);
  }
  return envelope.result;
}

function iso(at: number): string {
  return new Date(at).toISOString();
}

function param(at: number): string {
  return encodeURIComponent(iso(at));
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Durable Object storage holds at most this much in one value; a snapshot is split across keys. */
const CHUNK_CHARS = 500_000;

/** A {@link SnapshotStore} in a Durable Object's storage, under keys starting with `key`. */
export function storageSnapshotStore(
  storage: DurableObjectStorage,
  key: string,
): SnapshotStore {
  const headKey = `${key}:head`;
  const chunkKey = (index: number) => `${key}:${index}`;
  return {
    async load() {
      const head = await storage.get<{ chunks: number; restoring: boolean }>(headKey);
      if (!head) return null;
      const parts: string[] = [];
      for (let index = 0; index < head.chunks; index++) {
        const part = await storage.get<string>(chunkKey(index));
        if (part === undefined) return null;
        parts.push(part);
      }
      return {
        snapshot: JSON.parse(parts.join("")) as RouterSnapshot,
        restoring: head.restoring,
      };
    },
    async save(snapshot) {
      // The head goes last: a save cut short leaves no head, so nothing half-written is read.
      const text = JSON.stringify(snapshot);
      const chunks = Math.max(1, Math.ceil(text.length / CHUNK_CHARS));
      const before = await storage.get<{ chunks: number }>(headKey);
      await storage.delete(headKey);
      for (let index = 0; index < chunks; index++) {
        await storage.put(
          chunkKey(index),
          text.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS),
        );
      }
      await storage.put(headKey, { chunks, restoring: true });
      for (let index = chunks; index < (before?.chunks ?? 0); index++) {
        await storage.delete(chunkKey(index));
      }
    },
    async markNotRestoring() {
      const head = await storage.get<{ chunks: number; restoring: boolean }>(headKey);
      if (head) await storage.put(headKey, { ...head, restoring: false });
    },
    async clear() {
      const head = await storage.get<{ chunks: number }>(headKey);
      await storage.delete(headKey);
      for (let index = 0; index < (head?.chunks ?? 0); index++) {
        await storage.delete(chunkKey(index));
      }
    },
  };
}
