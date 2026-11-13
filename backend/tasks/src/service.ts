import { and, desc, eq, inArray, or } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { endOfDay } from "@backend/commons/time";
import { getDb } from "@backend/db-models/db";
import { task, taskShare } from "@backend/db-models/tasks";
import { knownUserIds } from "@backend/household/users";
import {
  alarmMinutesOf,
  dropAlarms,
  forgetAlarm,
  rearmAlarms,
  setAlarm,
  type AlarmRing,
} from "@backend/notifications/alarms";
import { timeZoneOf } from "@backend/notifications/service";
import type { Alarm } from "@shared/contract/app/notifications";
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
  // Its due day, or who sees it, may have changed under someone's alarm.
  await rearmAlarms("task", [id]);
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
  await dropAlarms("task", [id]);
  log.info("task removed", { taskId: id, userId: principal.userId });
}

/** The caller's own alarm on the task. */
export async function getTaskAlarm(principal: Principal, id: string): Promise<Alarm> {
  await getTask(principal, id);
  return { minutesBefore: await alarmMinutesOf("task", id, principal.userId) };
}

/**
 * Sets, changes or (null) removes the caller's own alarm on a task they see: a
 * reminder that long before its due day ends. Others are unaffected.
 */
export async function setTaskAlarm(
  principal: Principal,
  id: string,
  minutesBefore: Alarm["minutesBefore"],
): Promise<Alarm> {
  await getTask(principal, id);
  await setAlarm("task", id, principal.userId, minutesBefore);
  return { minutesBefore };
}

/**
 * The member's ring on the task when it is later than `after`, for their
 * alarm's object: before the due day ends, in the zone of their latest
 * subscribed device. Null when they set no alarm, or the task is done, has no
 * due day or is past; a task that is gone, or no longer theirs to see, loses
 * the alarm. It acts for no one: an alarm rings on its own.
 */
export async function nextTaskRing(
  taskId: string,
  userId: string,
  after: number,
): Promise<AlarmRing | null> {
  const minutes = await alarmMinutesOf("task", taskId, userId);
  if (minutes === null) return null;
  const row = await getDb().select().from(task).where(eq(task.id, taskId)).get();
  const shares = row ? ((await sharesOf([taskId])).get(taskId) ?? []) : [];
  if (!row || !(row.creatorId === userId || shares.some((s) => s.userId === userId))) {
    await forgetAlarm("task", taskId, userId);
    return null;
  }
  if (row.completedAt || !row.dueDate) return null;
  const at = endOfDay(row.dueDate, (await timeZoneOf(userId)) ?? "UTC");
  const ringAt = at - minutes * 60_000;
  if (ringAt <= after) return null;
  return {
    ringAt,
    at,
    muted: false,
    message: {
      title: row.title,
      body: "Due today",
      url: "/tasks",
      tag: `task:${row.id}`,
    },
  };
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
