import { and, between, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { getDb } from "@backend/db-models/db";
import { task, taskShare } from "@backend/db-models/tasks";
import { knownUserIds } from "@backend/household/users";
import type { Task, TaskCreate, TaskUpdate } from "@shared/contract/app/tasks";
import { taskPermissions } from "./permissions";

const log = logger("tasks/service");

type TaskRow = typeof task.$inferSelect;
type ShareRow = typeof taskShare.$inferSelect;

/**
 * Tasks the caller created or was given, open ones first, each by due date
 * (undated last) and then newest first.
 */
export async function listTasks(principal: Principal): Promise<Task[]> {
  taskPermissions.require(principal, "view");
  const db = getDb();
  const mine = db
    .select({ taskId: taskShare.taskId })
    .from(taskShare)
    .where(eq(taskShare.userId, principal.userId));
  const rows = await db
    .select()
    .from(task)
    .where(or(eq(task.creatorId, principal.userId), inArray(task.id, mine)))
    .orderBy(desc(task.createdAt));
  const shares = await sharesOf(rows.map((row) => row.id));
  return rows.map((row) => toTask(row, shares.get(row.id) ?? [])).sort(byOrder);
}

/** An open task with a due day, and who is reminded of it. */
export interface DueTask {
  id: string;
  title: string;
  dueDate: string;
  /** Its assignees, or its creator when nobody is assigned. */
  remindUserIds: string[];
}

/**
 * Open tasks due on a day between `fromDay` and `toDay` (inclusive,
 * `YYYY-MM-DD`), for the reminder sweep. It acts for no one: the sweep runs
 * on a schedule, not for a principal.
 */
export async function openTasksDueBetween(
  fromDay: string,
  toDay: string,
): Promise<DueTask[]> {
  const rows = await getDb()
    .select()
    .from(task)
    .where(and(isNull(task.completedAt), between(task.dueDate, fromDay, toDay)));
  const shares = await sharesOf(rows.map((row) => row.id));
  return rows.map((row) => {
    const { assignees } = toTask(row, shares.get(row.id) ?? []);
    return {
      id: row.id,
      title: row.title,
      dueDate: row.dueDate!,
      remindUserIds: assignees.length > 0 ? assignees : [row.creatorId],
    };
  });
}

export async function createTask(principal: Principal, input: TaskCreate): Promise<Task> {
  taskPermissions.require(principal, "create");
  const db = getDb();
  const id = newEntityId("TASK");
  const { sharedWith, assignees } = await resolvePeople(
    principal.userId,
    input.sharedWith ?? [],
    input.assignees ?? [],
  );
  const [row] = await db
    .insert(task)
    .values({
      id,
      title: input.title,
      description: input.description ?? "",
      creatorId: principal.userId,
      dueDate: input.dueDate ?? null,
    })
    .returning();
  await writeShares(id, sharedWith, assignees);
  log.info("task created", { taskId: id, userId: principal.userId });
  return toTask(row!, await sharesOf([id]).then((m) => m.get(id) ?? []));
}

export async function updateTask(
  principal: Principal,
  id: string,
  changes: TaskUpdate,
): Promise<Task> {
  taskPermissions.require(principal, "update");
  const sharing = Boolean(changes.sharedWith || changes.assignees);
  if (sharing) taskPermissions.require(principal, "share");
  const current = await getTask(principal, id);
  if (sharing && !canManage(principal, current)) {
    throw new DomainError(
      "FORBIDDEN",
      "Only the task's creator changes who it is shared with",
    );
  }
  const db = getDb();
  const [row] = await db
    .update(task)
    .set({
      ...(changes.title !== undefined && { title: changes.title }),
      ...(changes.description !== undefined && { description: changes.description }),
      ...(changes.dueDate !== undefined && { dueDate: changes.dueDate }),
      ...(changes.completed !== undefined && {
        completedAt: changes.completed ? new Date() : null,
      }),
      updatedAt: new Date(),
    })
    .where(eq(task.id, id))
    .returning();
  if (changes.sharedWith || changes.assignees) {
    const { sharedWith, assignees } = await resolvePeople(
      current.creatorId,
      changes.sharedWith ?? current.sharedWith,
      changes.assignees ?? current.assignees,
    );
    await db.delete(taskShare).where(eq(taskShare.taskId, id));
    await writeShares(id, sharedWith, assignees);
  }
  log.info("task updated", { taskId: id, userId: principal.userId });
  return toTask(row!, await sharesOf([id]).then((m) => m.get(id) ?? []));
}

export async function removeTask(principal: Principal, id: string): Promise<void> {
  taskPermissions.require(principal, "remove");
  const current = await getTask(principal, id);
  if (!canManage(principal, current)) {
    throw new DomainError("FORBIDDEN", "Only the task's creator removes it");
  }
  const db = getDb();
  await db.delete(taskShare).where(eq(taskShare.taskId, id));
  await db.delete(task).where(eq(task.id, id));
  log.info("task removed", { taskId: id, userId: principal.userId });
}

/** The task, when the caller created it or was given it. */
export async function getTask(principal: Principal, id: string): Promise<Task> {
  taskPermissions.require(principal, "view");
  const row = await getDb().select().from(task).where(eq(task.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Task not found");
  const shares = (await sharesOf([id])).get(id) ?? [];
  const item = toTask(row, shares);
  if (!canSee(principal, item)) throw new DomainError("NOT_FOUND", "Task not found");
  return item;
}

function canSee(principal: Principal, item: Task): boolean {
  return (
    item.creatorId === principal.userId || item.sharedWith.includes(principal.userId)
  );
}

function canManage(principal: Principal, item: Task): boolean {
  return item.creatorId === principal.userId || principal.role === "owner";
}

/** Shares as given, without the creator; assignees limited to the creator and the shares. */
async function resolvePeople(
  creatorId: string,
  sharedWith: readonly string[],
  assignees: readonly string[],
): Promise<{ sharedWith: string[]; assignees: string[] }> {
  const shared = (await knownUserIds(sharedWith)).filter((id) => id !== creatorId);
  const allowed = new Set([creatorId, ...shared]);
  const assigned = [...new Set(assignees)].filter((id) => allowed.has(id));
  return { sharedWith: shared, assignees: assigned };
}

async function writeShares(
  taskId: string,
  sharedWith: string[],
  assignees: string[],
): Promise<void> {
  const people = new Set([...sharedWith, ...assignees]);
  if (people.size === 0) return;
  await getDb()
    .insert(taskShare)
    .values(
      [...people].map((userId) => ({
        id: newEntityId("TASK_SHARE"),
        taskId,
        userId,
        assigned: assignees.includes(userId),
      })),
    );
}

async function sharesOf(taskIds: string[]): Promise<Map<string, ShareRow[]>> {
  const out = new Map<string, ShareRow[]>();
  if (taskIds.length === 0) return out;
  const rows = await getDb()
    .select()
    .from(taskShare)
    .where(and(inArray(taskShare.taskId, taskIds)));
  for (const row of rows) {
    const list = out.get(row.taskId) ?? [];
    list.push(row);
    out.set(row.taskId, list);
  }
  return out;
}

function toTask(row: TaskRow, shares: ShareRow[]): Task {
  const assignees = shares.filter((s) => s.assigned).map((s) => s.userId);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    creatorId: row.creatorId,
    dueDate: row.dueDate,
    completedAt: row.completedAt?.getTime() ?? null,
    // The creator may be assigned without being a share.
    sharedWith: shares.map((s) => s.userId).filter((id) => id !== row.creatorId),
    assignees,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function byOrder(a: Task, b: Task): number {
  const doneA = a.completedAt !== null ? 1 : 0;
  const doneB = b.completedAt !== null ? 1 : 0;
  if (doneA !== doneB) return doneA - doneB;
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return b.createdAt - a.createdAt;
}
