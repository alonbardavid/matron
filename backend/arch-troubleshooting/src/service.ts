import { inArray } from "drizzle-orm";
import {
  beginRevert,
  listMerged,
  markRevertFailed,
  revertableUntil,
  revertRefusal,
} from "@backend/arch-branches/service";
import { startRevert } from "@backend/arch-builder/jobs";
import { checkRestorePoint } from "@backend/arch-time-travel/service";
import { DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { branches } from "@backend/db-models/arch-branches";
import { user } from "@backend/db-models/arch-auth";
import { buildSessions } from "@backend/db-models/arch-sessions";
import { getDb } from "@backend/db-models/db";
import type {
  ApiProblem,
  TroubleshootingContainer,
  TroubleshootingDatabase,
  TroubleshootingMerge,
} from "@shared/contract/arch/troubleshooting";
import {
  CONTAINERS_PERMISSION,
  cloudflare,
  CloudflareError,
  D1_PERMISSION,
  problemOf,
  WORKERS_PERMISSION,
} from "./cloudflare";
import { troubleshootingEnv } from "./env";
import { troubleshootingPermissions } from "./permissions";

const log = logger("arch-troubleshooting/service");

/** What a D1 database may hold. */
const D1_MAX_BYTES = 10 * 1024 ** 3;
// Containers list prices, per second of running time: memory and disk for what
// is provisioned, vCPU for what is used, so the sum is what an instance cost at most.
const VCPU_USD_PER_SECOND = 0.00002;
const MEMORY_USD_PER_GIB_SECOND = 0.0000025;
const DISK_USD_PER_GB_SECOND = 0.00000007;

type Listing<T> = { items: T[]; problem: ApiProblem | null };

// ── Databases ─────────────────────────────────────────────────────────────────

interface D1Row {
  uuid: string;
  name: string;
  file_size?: number;
  num_tables?: number;
  created_at?: string;
}

/** The deployment's databases: production's and every Preview's. */
export async function listDatabases(
  principal: Principal,
): Promise<Listing<TroubleshootingDatabase>> {
  troubleshootingPermissions.require(principal, "manage");
  const worker = troubleshootingEnv().WORKER_NAME;
  try {
    const rows = await databaseRows(worker);
    const branchRows = await getDb()
      .select({ name: branches.name, databaseName: branches.databaseName })
      .from(branches);
    const branchOf = new Map(branchRows.map((row) => [row.databaseName, row.name]));
    const items = rows.map((row): TroubleshootingDatabase => ({
      id: row.uuid,
      name: row.name,
      kind: row.name === worker ? "production" : "preview",
      sizeBytes: row.file_size ?? 0,
      maxBytes: D1_MAX_BYTES,
      tables: row.num_tables ?? null,
      createdAt: when(row.created_at),
      branchName: branchOf.get(row.name) ?? null,
    }));
    return { items, problem: null };
  } catch (err) {
    return { items: [], problem: problemOf(err) };
  }
}

/** A Preview's database. The production one stays whatever is asked. */
export async function removeDatabase(principal: Principal, id: string): Promise<void> {
  troubleshootingPermissions.require(principal, "manage");
  const worker = troubleshootingEnv().WORKER_NAME;
  const row = (await mustCall(() => databaseRows(worker))).find((d) => d.uuid === id);
  if (!row) throw new DomainError("NOT_FOUND", "No such database");
  if (row.name === worker) {
    throw new DomainError(
      "FORBIDDEN",
      "The production database is not removed from here",
    );
  }
  await mustCall(() =>
    cloudflare(`/d1/database/${id}`, { method: "DELETE", permission: D1_PERMISSION }),
  );
  log.info("database removed", { name: row.name, userId: principal.userId });
}

async function databaseRows(worker: string): Promise<D1Row[]> {
  const { result } = await cloudflare<D1Row[]>(
    `/d1/database?per_page=100&name=${encodeURIComponent(worker)}`,
    { permission: D1_PERMISSION },
  );
  return result.filter((row) => row.name === worker || row.name.startsWith(`${worker}-`));
}

// ── Merges ────────────────────────────────────────────────────────────────────

/** Every merged branch, the latest first, with whether it can be reverted now. */
export async function listMerges(
  principal: Principal,
): Promise<Listing<TroubleshootingMerge>> {
  troubleshootingPermissions.require(principal, "manage");
  const rows = await listMerged();
  const now = Date.now();
  const items: TroubleshootingMerge[] = [];
  for (const row of rows) {
    const active =
      row.revertStatus === "reverting" && (await builderActive(row.buildSessionId));
    const mergedAt = row.archivedAt?.getTime() ?? null;
    items.push({
      id: row.id,
      name: row.name,
      userName: row.userName,
      sessionTitle: row.sessionTitle,
      createdAt: row.createdAt.getTime(),
      mergedAt,
      baseCommit: row.baseCommit,
      headCommit: row.headCommit,
      revertStatus: row.revertStatus,
      revertError: row.revertError,
      revertedAt: row.revertedAt?.getTime() ?? null,
      revertableUntil: revertableUntil(row.createdAt),
      refusal: await revertRefusal(row, active, now),
      // The same rule as laterMerges, on the rows at hand.
      later: rows
        .filter(
          (other) =>
            mergedAt !== null &&
            (other.archivedAt?.getTime() ?? 0) > mergedAt &&
            other.revertStatus !== "reverted",
        )
        .map((other) => other.name),
    });
  }
  return { items, problem: null };
}

/**
 * Reverts a merged branch and every merge after it: the builder commits the
 * tree main had before the merge and deploys it, after restoring the
 * production database to when the branch was created.
 */
export async function revertMerge(principal: Principal, id: string): Promise<void> {
  troubleshootingPermissions.require(principal, "manage");
  const { branch, later } = await beginRevert(principal, id, builderActive);
  try {
    await checkRestorePoint(branch.createdAt.getTime());
    await startRevert(branch, later);
  } catch (err) {
    await markRevertFailed(id, err instanceof Error ? err.message : String(err));
    throw err;
  }
  log.info("revert requested", {
    branchId: id,
    later: later.map((row) => row.id),
    userId: principal.userId,
  });
}

async function builderActive(buildSessionId: string): Promise<boolean> {
  return (await troubleshootingEnv().BUILDERS.getByName(buildSessionId).status()).active;
}

// ── Containers ────────────────────────────────────────────────────────────────

interface NamespaceRow {
  id: string;
  script: string;
  class: string;
  preview?: { name: string } | null;
}

interface ApplicationRow {
  id: string;
  name: string;
  durable_objects?: { namespace_id?: string };
}

interface InstanceRow {
  id: string;
  name: string;
  started_at?: string;
  status: { state: string; updated_at?: string };
  location?: { name?: string };
  configuration?: { vcpu?: number; memory?: number; disk?: number };
}

/** The builder's container instances, running and stopped. */
export async function listContainers(
  principal: Principal,
): Promise<Listing<TroubleshootingContainer>> {
  troubleshootingPermissions.require(principal, "manage");
  try {
    const rows = await instanceRows();
    const people = await sessionPeople(rows.map((row) => row.name));
    const now = Date.now();
    const items = rows.map((row): TroubleshootingContainer => {
      const running = row.status.state === "running";
      const startedAt = when(row.started_at);
      const lastActivityAt = when(row.status.updated_at) ?? startedAt;
      const end = running ? now : (lastActivityAt ?? now);
      const seconds = startedAt === null ? null : Math.max(0, (end - startedAt) / 1000);
      const vcpu = row.configuration?.vcpu ?? null;
      const memoryMiB = row.configuration?.memory ?? null;
      const diskMB = row.configuration?.disk ?? null;
      const who = people.get(row.name);
      return {
        id: row.id,
        name: row.name,
        state: row.status.state,
        running,
        startedAt,
        lastActivityAt,
        location: row.location?.name ?? null,
        vcpu,
        memoryMiB,
        diskMB,
        costUsd:
          seconds === null
            ? null
            : seconds *
              ((vcpu ?? 0) * VCPU_USD_PER_SECOND +
                ((memoryMiB ?? 0) / 1024) * MEMORY_USD_PER_GIB_SECOND +
                ((diskMB ?? 0) / 1000) * DISK_USD_PER_GB_SECOND),
        userId: who?.userId ?? null,
        userName: who?.userName ?? null,
        sessionTitle: who?.title ?? null,
      };
    });
    return { items, problem: null };
  } catch (err) {
    return { items: [], problem: problemOf(err) };
  }
}

/** Stops a running instance through its builder: the workspace is snapshotted, a running job parks. */
export async function stopContainer(principal: Principal, name: string): Promise<void> {
  troubleshootingPermissions.require(principal, "manage");
  await troubleshootingEnv().BUILDERS.getByName(name).stopContainer();
  log.info("container stopped", { name, userId: principal.userId });
}

/** Stops every running instance. Cloudflare keeps the records of stopped ones; nothing removes those. */
export async function clearContainers(principal: Principal): Promise<void> {
  troubleshootingPermissions.require(principal, "manage");
  const rows = await mustCall(instanceRows);
  for (const row of rows.filter((r) => r.status.state === "running")) {
    await stopContainer(principal, row.name);
  }
}

async function instanceRows(): Promise<InstanceRow[]> {
  const app = await builderApplication();
  if (!app) return [];
  const { result } = await cloudflare<{ instances?: InstanceRow[] } | InstanceRow[]>(
    `/containers/applications/${app.id}/instances`,
    { permission: CONTAINERS_PERMISSION },
  );
  return Array.isArray(result) ? result : (result.instances ?? []);
}

/** The container application behind this deployment's builder objects. */
async function builderApplication(): Promise<ApplicationRow | null> {
  const builderNamespace = (await namespaceRows()).find(
    (ns) => !ns.preview && ns.class === "BuilderObject",
  );
  if (!builderNamespace) return null;
  const { result } = await cloudflare<ApplicationRow[]>("/containers/applications", {
    permission: CONTAINERS_PERMISSION,
  });
  return (
    result.find((app) => app.durable_objects?.namespace_id === builderNamespace.id) ??
    null
  );
}

/** The namespaces of this Worker's classes: the deployment's own and every Preview's. */
async function namespaceRows(): Promise<NamespaceRow[]> {
  const worker = troubleshootingEnv().WORKER_NAME;
  const { result } = await cloudflare<NamespaceRow[]>(
    "/workers/durable_objects/namespaces?per_page=100",
    { permission: WORKERS_PERMISSION },
  );
  return result.filter((ns) => ns.script === worker);
}

// ── People ────────────────────────────────────────────────────────────────────

interface Person {
  userId: string;
  userName: string | null;
  title: string | null;
  createdAt: number | null;
  updatedAt: number | null;
}

async function sessionPeople(sessionIds: string[]): Promise<Map<string, Person>> {
  const ids = [...new Set(sessionIds)];
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({
      id: buildSessions.id,
      userId: buildSessions.userId,
      title: buildSessions.title,
      createdAt: buildSessions.createdAt,
      updatedAt: buildSessions.updatedAt,
    })
    .from(buildSessions)
    .where(inArray(buildSessions.id, ids));
  const names = await userNames(rows.map((row) => row.userId));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        userId: row.userId,
        userName: names.get(row.userId) ?? null,
        title: row.title,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
      },
    ]),
  );
}

async function userNames(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, ids));
  return new Map(rows.map((row) => [row.id, row.name]));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function when(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** A call whose failure is the answer, as an error the route can report. */
async function mustCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof CloudflareError) {
      throw new DomainError(
        err.problem.kind === "error" ? "UNAVAILABLE" : "FORBIDDEN",
        err.message,
      );
    }
    throw err;
  }
}
