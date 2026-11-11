import { env } from "cloudflare:workers";
import { and, desc, eq, isNull, like } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import { MAIN_BRANCH, type Principal } from "@backend/commons/principal";
import { user } from "@backend/db-models/arch-auth";
import { branches, type BranchStatus } from "@backend/db-models/arch-branches";
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
    // The production database carries the Worker's name.
    WORKER_NAME,
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

/** Owners abandon any branch; whoever may build abandons the branches they started. */
export async function beginAbandon(principal: Principal, id: string): Promise<BranchRow> {
  const owns = branchPermissions.can(principal.role, "merge");
  if (!owns) branchPermissions.require(principal, "create");
  const branch = await getBranch(id);
  if (!owns && branch.userId !== principal.userId) {
    throw new DomainError("FORBIDDEN", "This is not your branch");
  }
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
