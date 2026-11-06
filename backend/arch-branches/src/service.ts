import { env } from "cloudflare:workers";
import { and, desc, eq, gt, isNull, like, ne, or } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import { deploymentNames } from "@backend/commons/names";
import { MAIN_BRANCH, type Principal } from "@backend/commons/principal";
import { user } from "@backend/db-models/arch-auth";
import {
  branches,
  type BranchStatus,
  type RevertStatus,
} from "@backend/db-models/arch-branches";
import { buildSessions } from "@backend/db-models/arch-sessions";
import { getDb } from "@backend/db-models/db";
import type { Branch } from "@shared/contract/arch/branches";
import { branchNames, branchSlug, uniqueSlug } from "./names";
import { branchPermissions } from "./permissions";

const log = logger("arch-branches/service");

export interface BranchRow {
  id: string;
  name: string;
  previewName: string;
  previewUrl: string | null;
  databaseId: string | null;
  databaseName: string | null;
  buildSessionId: string;
  userId: string;
  baseCommit: string;
  headCommit: string | null;
  status: BranchStatus;
  archivedAt: Date | null;
  revertStatus: RevertStatus | null;
  revertError: string | null;
  revertedAt: Date | null;
  createdAt: Date;
}

/**
 * How far back the production database can be restored: D1 Time Travel keeps
 * thirty days. A revert must start an hour inside them, so the restore point is
 * still there when the job reaches it.
 */
export const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60_000;
const RESTORE_MARGIN_MS = 60 * 60_000;

/** The last moment a revert of a branch created at `createdAt` may start. */
export function revertableUntil(createdAt: Date): number {
  return createdAt.getTime() + RESTORE_WINDOW_MS - RESTORE_MARGIN_MS;
}

/**
 * Every branch. `mainHead` is main's current commit, or null when the
 * repository could not say; a live branch whose base differs is behind main.
 */
export async function listBranches(
  principal: Principal,
  mainHead: string | null,
): Promise<Branch[]> {
  if (!branchPermissions.can(principal.role, "view")) return [];
  const rows = await getDb()
    .select({ branch: branches, userName: user.name, clearedAt: buildSessions.clearedAt })
    .from(branches)
    .innerJoin(user, eq(user.id, branches.userId))
    .leftJoin(buildSessions, eq(buildSessions.id, branches.buildSessionId))
    .orderBy(desc(branches.createdAt));
  return rows.map(({ branch, userName, clearedAt }) =>
    toBranch(branch, userName, {
      sessionViewable: clearedAt === null,
      behindMain:
        mainHead !== null && branch.archivedAt === null && branch.baseCommit !== mainHead,
    }),
  );
}

/**
 * The branch a request names: null for main, the row while it is live, and
 * NOT_FOUND for an id that is unknown or archived.
 */
export async function resolveBranch(branchId: string): Promise<BranchRow | null> {
  if (branchId === MAIN_BRANCH) return null;
  const [row] = await getDb()
    .select()
    .from(branches)
    .where(and(eq(branches.id, branchId), isNull(branches.archivedAt)));
  if (!row) throw new DomainError("NOT_FOUND", "Branch not found");
  return row;
}

/** A live branch by id; main is not one. */
export async function getBranch(id: string): Promise<BranchRow> {
  const branch = await resolveBranch(id);
  if (!branch) throw new DomainError("NOT_FOUND", "Branch not found");
  return branch;
}

export async function branchForSession(
  buildSessionId: string,
): Promise<BranchRow | null> {
  const [row] = await getDb()
    .select()
    .from(branches)
    .where(eq(branches.buildSessionId, buildSessionId));
  return row ?? null;
}

/**
 * The row the builder deploys into. Names are derived once here so the
 * preview, the git branch and the D1 database all agree. `name` is the
 * planner's short name for the change; a name a branch had before, archived
 * or not, gets a digit.
 */
export async function createBranch(
  principal: Principal,
  input: { buildSessionId: string; name: string; baseCommit: string },
): Promise<BranchRow> {
  if (!branchPermissions.can(principal.role, "create")) {
    throw new DomainError("FORBIDDEN", "You cannot create branches");
  }
  const id = newEntityId("BRANCH");
  const { WORKER_NAME } = env as unknown as { WORKER_NAME: string };
  const slug = branchSlug(input.name);
  const taken = await getDb()
    .select({ name: branches.name })
    .from(branches)
    .where(like(branches.name, `${slug}%`));
  const names = branchNames(
    uniqueSlug(
      slug,
      taken.map((row) => row.name),
    ),
    deploymentNames(WORKER_NAME).database,
  );
  const [row] = await getDb()
    .insert(branches)
    .values({
      id,
      name: names.branch,
      previewName: names.preview,
      databaseName: names.database,
      buildSessionId: input.buildSessionId,
      userId: principal.userId,
      baseCommit: input.baseCommit,
    })
    .returning();
  log.info("branch created", { branchId: id, buildSessionId: input.buildSessionId });
  return row!;
}

export async function markDeployed(
  id: string,
  deployed: {
    previewUrl: string;
    databaseId: string;
    headCommit: string;
    /** Set when the builder merged main into the branch. */
    baseCommit?: string;
  },
): Promise<void> {
  const { baseCommit, ...rest } = deployed;
  await getDb()
    .update(branches)
    .set({
      ...rest,
      ...(baseCommit ? { baseCommit } : {}),
      status: "ready",
      updatedAt: new Date(),
    })
    .where(eq(branches.id, id));
  log.info("branch deployed", { branchId: id });
}

/**
 * Checks the merge may start and marks the branch merging. Main must still be
 * at the branch's base commit; the builder does the git work afterwards.
 */
export async function beginMerge(
  principal: Principal,
  id: string,
  mainHead: string,
): Promise<BranchRow> {
  if (!branchPermissions.can(principal.role, "merge")) {
    throw new DomainError("FORBIDDEN", "You cannot merge branches");
  }
  const branch = await getBranch(id);
  if (branch.status !== "ready") {
    throw new DomainError("CONFLICT", "The branch is not ready to merge");
  }
  if (await revertUnderWay()) {
    throw new DomainError(
      "CONFLICT",
      "A revert is under way; merge once it has finished",
    );
  }
  if (branch.baseCommit !== mainHead) {
    log.info("merge refused: main moved", { branchId: id });
    throw new DomainError(
      "CONFLICT",
      "Main has changed since this branch was created; ask the builder to pull main first",
    );
  }
  await getDb()
    .update(branches)
    .set({ status: "merging", updatedAt: new Date() })
    .where(eq(branches.id, id));
  log.info("merge started", { branchId: id, userId: principal.userId });
  return { ...branch, status: "merging" };
}

export async function beginAbandon(principal: Principal, id: string): Promise<BranchRow> {
  if (!branchPermissions.can(principal.role, "merge")) {
    throw new DomainError("FORBIDDEN", "You cannot abandon branches");
  }
  const branch = await getBranch(id);
  if (branch.status === "merging") {
    throw new DomainError("CONFLICT", "The branch is being merged");
  }
  log.info("abandon started", { branchId: id, userId: principal.userId });
  return branch;
}

/**
 * After a merge or abandon finished: the Preview and database are gone, the
 * row stays as archived history.
 */
export async function archiveBranch(
  id: string,
  status: "merged" | "abandoned",
): Promise<void> {
  await getDb()
    .update(branches)
    .set({
      status,
      archivedAt: new Date(),
      previewUrl: null,
      databaseId: null,
      updatedAt: new Date(),
    })
    .where(eq(branches.id, id));
  log.info("branch archived", { branchId: id, status });
}

/** Resets a branch whose merge or abandon failed, so it can be retried. */
export async function markReady(id: string): Promise<void> {
  await getDb()
    .update(branches)
    .set({ status: "ready", updatedAt: new Date() })
    .where(eq(branches.id, id));
}

// ── Reverts ───────────────────────────────────────────────────────────────────

export interface MergedBranchRow extends BranchRow {
  userName: string;
  sessionTitle: string | null;
}

/** Every merged branch, the latest merge first, with who made it. */
export async function listMerged(): Promise<MergedBranchRow[]> {
  const rows = await getDb()
    .select({ branch: branches, userName: user.name, sessionTitle: buildSessions.title })
    .from(branches)
    .innerJoin(user, eq(user.id, branches.userId))
    .leftJoin(buildSessions, eq(buildSessions.id, branches.buildSessionId))
    .where(eq(branches.status, "merged"))
    .orderBy(desc(branches.archivedAt));
  return rows.map(({ branch, userName, sessionTitle }) => ({
    ...branch,
    userName,
    sessionTitle,
  }));
}

/**
 * The merges after `branch` still on main: going back to before `branch`
 * takes them out too.
 */
export async function laterMerges(branch: BranchRow): Promise<BranchRow[]> {
  if (!branch.archivedAt) return [];
  return getDb()
    .select()
    .from(branches)
    .where(
      and(
        eq(branches.status, "merged"),
        gt(branches.archivedAt, branch.archivedAt),
        or(isNull(branches.revertStatus), ne(branches.revertStatus, "reverted")),
      ),
    )
    .orderBy(desc(branches.archivedAt));
}

/**
 * Why `branch` cannot be reverted now, or null when it can. `builderActive`
 * says whether its builder is running a job: a revert marked under way whose
 * builder is idle stopped without reporting, and may be started again.
 */
export async function revertRefusal(
  branch: BranchRow,
  builderActive: boolean,
  now = Date.now(),
): Promise<string | null> {
  if (branch.status !== "merged") return "Only a merged branch can be reverted";
  if (branch.revertStatus === "reverted") return "Already reverted";
  if (branch.revertStatus === "reverting" && builderActive) return "Being reverted";
  if (now > revertableUntil(branch.createdAt)) {
    return "Created more than 30 days ago: the database cannot be restored that far back";
  }
  const [busy] = await getDb()
    .select({ name: branches.name, status: branches.status })
    .from(branches)
    .where(
      and(
        ne(branches.id, branch.id),
        or(eq(branches.status, "merging"), eq(branches.revertStatus, "reverting")),
      ),
    )
    .limit(1);
  if (busy) {
    return busy.status === "merging"
      ? `${busy.name} is being merged`
      : `${busy.name} is being reverted`;
  }
  return null;
}

/**
 * Checks a revert may start and marks the branch reverting. Returns the
 * branch and the later merges the revert takes out with it. `builderActive`
 * is asked only about a branch already marked reverting.
 */
export async function beginRevert(
  principal: Principal,
  id: string,
  builderActive: (buildSessionId: string) => Promise<boolean>,
): Promise<{ branch: BranchRow; later: BranchRow[] }> {
  if (!branchPermissions.can(principal.role, "merge")) {
    throw new DomainError("FORBIDDEN", "You cannot revert branches");
  }
  const [branch] = await getDb().select().from(branches).where(eq(branches.id, id));
  if (!branch) throw new DomainError("NOT_FOUND", "Branch not found");
  const active =
    branch.revertStatus === "reverting" && (await builderActive(branch.buildSessionId));
  const refusal = await revertRefusal(branch, active);
  if (refusal) throw new DomainError("CONFLICT", refusal);
  await getDb()
    .update(branches)
    .set({ revertStatus: "reverting", revertError: null, updatedAt: new Date() })
    .where(eq(branches.id, id));
  log.info("revert started", { branchId: id, userId: principal.userId });
  return {
    branch: { ...branch, revertStatus: "reverting" },
    later: await laterMerges(branch),
  };
}

/** Main and the database are back to before `id`: it and every later merge are reverted. */
export async function markReverted(id: string): Promise<void> {
  const [branch] = await getDb().select().from(branches).where(eq(branches.id, id));
  if (!branch) return;
  const later = await laterMerges(branch);
  const at = new Date();
  for (const row of [branch, ...later]) {
    await getDb()
      .update(branches)
      .set({ revertStatus: "reverted", revertError: null, revertedAt: at, updatedAt: at })
      .where(eq(branches.id, row.id));
  }
  log.info("branch reverted", { branchId: id, later: later.map((row) => row.id) });
}

/** The revert stopped; it may be started again. */
export async function markRevertFailed(id: string, error: string): Promise<void> {
  await getDb()
    .update(branches)
    .set({ revertStatus: "failed", revertError: error, updatedAt: new Date() })
    .where(eq(branches.id, id));
  log.info("revert failed", { branchId: id });
}

async function revertUnderWay(): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.revertStatus, "reverting"))
    .limit(1);
  return row !== undefined;
}

function toBranch(
  row: typeof branches.$inferSelect,
  userName: string,
  derived: { sessionViewable: boolean; behindMain: boolean },
): Branch {
  return {
    id: row.id,
    name: row.name,
    previewName: row.previewName,
    previewUrl: row.previewUrl,
    buildSessionId: row.buildSessionId,
    sessionViewable: derived.sessionViewable,
    behindMain: derived.behindMain,
    userId: row.userId,
    userName,
    status: row.status,
    archivedAt: row.archivedAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}
