import { tz } from "@date-fns/tz";
import { addDays, parseISO } from "date-fns";
import { and, eq, inArray, or } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { getDb } from "@backend/db-models/db";
import { list, listItem, listItemAssignee, listShare } from "@backend/db-models/lists";
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
import {
  LIST_COLORS,
  type ItemCreate,
  type ItemMove,
  type ItemUpdate,
  type List,
  type ListCreate,
  type ListItem,
  type ListUpdate,
  type SharePermission,
} from "@shared/contract/app/lists";
import type { Alarm } from "@shared/contract/app/notifications";
import { listPermissions } from "./permissions";

const log = logger("lists/service");

type ListRow = typeof list.$inferSelect;
type ShareRow = typeof listShare.$inferSelect;
type ItemRow = typeof listItem.$inferSelect;

/** D1 takes about a hundred parameters in one statement. */
const ID_CHUNK = 90;
const EVERYTHING: SharePermission[] = ["view", "share", "edit"];

/** A list as the caller holds it: its row, its shares, and what they may do. */
interface Held {
  row: ListRow;
  shares: ShareRow[];
  mine: SharePermission[];
}

// ---------------------------------------------------------------- lists

/**
 * The lists the caller made or was given, last changed first, each with all
 * its items. With `q`, only those whose name or any item's title holds it.
 */
export async function listLists(principal: Principal, q?: string): Promise<List[]> {
  listPermissions.require(principal, "view");
  const held = await heldLists(principal);
  const items = await itemsOf(held.map((h) => h.row.id));
  const needle = q?.trim().toLowerCase();
  return held
    .filter(
      ({ row }) =>
        !needle ||
        row.name.toLowerCase().includes(needle) ||
        (items.get(row.id) ?? []).some((item) =>
          item.title.toLowerCase().includes(needle),
        ),
    )
    .map((h) => ({ ...listFieldsOf(h), items: items.get(h.row.id) ?? [] }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The list with all its items, when the caller made it or was given it. */
export async function getList(principal: Principal, id: string): Promise<List> {
  const held = await holdList(principal, id);
  return { ...listFieldsOf(held), items: (await itemsOf([id])).get(id) ?? [] };
}

/** Makes a list; `id` is the one the browser picked for it, if it did. */
export async function createList(
  principal: Principal,
  input: ListCreate,
  id = newEntityId("LIST"),
): Promise<List> {
  listPermissions.require(principal, "create");
  const sharedWith = await resolveShares(principal.userId, input.sharedWith ?? []);
  const [row] = await getDb()
    .insert(list)
    .values({
      id,
      name: input.name,
      color: input.color ?? LIST_COLORS[0],
      creatorId: principal.userId,
    })
    .returning();
  if (sharedWith.length > 0) {
    listPermissions.require(principal, "share");
    await writeShares(id, sharedWith, input.permissions ?? {});
  }
  log.info("list created", { listId: id, userId: principal.userId });
  return getList(principal, row!.id);
}

/**
 * Its name and colour take edit. Who it is shared with, and who of them may
 * share it, take share; who may edit it takes edit as well.
 */
export async function updateList(
  principal: Principal,
  id: string,
  changes: ListUpdate,
): Promise<List> {
  listPermissions.require(principal, "update");
  const current = await holdList(principal, id);
  const currentShared = current.shares.map((s) => s.userId);
  const currentGranted = grantedOf(current.shares);
  // A save sends everything whether or not it changed: only a real change needs leave.
  const detailed =
    (changes.name !== undefined && changes.name !== current.row.name) ||
    (changes.color !== undefined && changes.color !== current.row.color);
  if (detailed) requireEdit(current);

  const sharedWith =
    changes.sharedWith !== undefined
      ? await resolveShares(current.row.creatorId, changes.sharedWith)
      : currentShared;
  const granted: Record<string, SharePermission[]> = Object.fromEntries(
    sharedWith.map((userId) => [
      userId,
      permissionsOf(changes.permissions?.[userId] ?? currentGranted[userId]),
    ]),
  );
  const sharing =
    differs(sharedWith, currentShared) ||
    sharedWith.some((userId) => differs(granted[userId]!, currentGranted[userId] ?? []));
  if (sharing) {
    listPermissions.require(principal, "share");
    requireShare(current);
    // Who may edit the list is part of the list: changing it takes editing.
    const editors = (all: Record<string, SharePermission[]>) =>
      sharedWith.filter((userId) => all[userId]?.includes("edit"));
    if (differs(editors(granted), editors(currentGranted))) requireEdit(current);
  }

  const db = getDb();
  await db
    .update(list)
    .set({
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.color !== undefined && { color: changes.color }),
      updatedAt: new Date(),
    })
    .where(eq(list.id, id));
  if (sharing) {
    await db.delete(listShare).where(eq(listShare.listId, id));
    await writeShares(id, sharedWith, granted);
    // Someone it is no longer shared with is no longer assigned in it.
    const seeing = new Set([current.row.creatorId, ...sharedWith]);
    const gone = currentShared.filter((userId) => !seeing.has(userId));
    const itemIds = ((await itemsOf([id])).get(id) ?? []).map((item) => item.id);
    if (gone.length > 0 && itemIds.length > 0) {
      for (const chunk of chunks(itemIds)) {
        await db
          .delete(listItemAssignee)
          .where(
            and(
              inArray(listItemAssignee.itemId, chunk),
              inArray(listItemAssignee.userId, gone),
            ),
          );
      }
    }
    await rearmAlarms("item", itemIds);
  }
  log.info("list updated", { listId: id, userId: principal.userId, sharing });
  return getList(principal, id);
}

/** Whoever made the list removes it, with its items. */
export async function removeList(principal: Principal, id: string): Promise<void> {
  listPermissions.require(principal, "remove");
  const current = await holdList(principal, id);
  if (current.row.creatorId !== principal.userId) {
    throw new DomainError("FORBIDDEN", "Only whoever made the list removes it");
  }
  const itemIds = ((await itemsOf([id])).get(id) ?? []).map((item) => item.id);
  await deleteItems(itemIds);
  const db = getDb();
  await db.delete(listShare).where(eq(listShare.listId, id));
  await db.delete(list).where(eq(list.id, id));
  log.info("list removed", { listId: id, userId: principal.userId });
}

// ---------------------------------------------------------------- items

/**
 * Adds an item last, at the top of the list or under another of its items;
 * `id` is the one the browser picked for it, if it did.
 */
export async function addItem(
  principal: Principal,
  listId: string,
  input: ItemCreate,
  id = newEntityId("LIST_ITEM"),
): Promise<ListItem> {
  listPermissions.require(principal, "update");
  const held = await holdList(principal, listId);
  requireEdit(held);
  const items = (await itemsOf([listId])).get(listId) ?? [];
  const parentId = input.parentId ?? null;
  if (parentId && !items.some((item) => item.id === parentId)) {
    throw new DomainError("BAD_REQUEST", "That item is not on this list");
  }
  const siblings = items.filter((item) => item.parentId === parentId);
  const position = Math.max(-1, ...siblings.map((item) => item.position)) + 1;
  await getDb()
    .insert(listItem)
    .values({
      id,
      listId,
      parentId,
      position,
      title: input.title,
      description: input.description ?? "",
      creatorId: principal.userId,
      dueDate: input.dueDate ?? null,
    });
  await writeAssignees(id, assignable(held, input.assignees ?? []));
  await touch(listId);
  log.info("list item added", { listId, itemId: id, userId: principal.userId });
  return getItem(principal, id);
}

export async function updateItem(
  principal: Principal,
  id: string,
  changes: ItemUpdate,
): Promise<ListItem> {
  listPermissions.require(principal, "update");
  const { row, held } = await holdItem(principal, id);
  requireEdit(held);
  const db = getDb();
  await db
    .update(listItem)
    .set({
      ...(changes.title !== undefined && { title: changes.title }),
      ...(changes.description !== undefined && { description: changes.description }),
      ...(changes.dueDate !== undefined && { dueDate: changes.dueDate }),
      ...(changes.completed !== undefined && {
        completedAt: changes.completed ? new Date() : null,
      }),
      updatedAt: new Date(),
    })
    .where(eq(listItem.id, id));
  if (changes.assignees !== undefined) {
    await db.delete(listItemAssignee).where(eq(listItemAssignee.itemId, id));
    await writeAssignees(id, assignable(held, changes.assignees));
  }
  await touch(row.listId);
  // Its due day, or whether it is done, may have changed under someone's alarm.
  await rearmAlarms("item", [id]);
  log.info("list item updated", { itemId: id, userId: principal.userId });
  return getItem(principal, id);
}

/**
 * Puts an item, with the items under it, under `parentId` (null: the top) at
 * `index` among the items there: reordering, nesting, taking it out a level,
 * or moving it to another list. Both lists take edit.
 */
export async function moveItem(
  principal: Principal,
  id: string,
  move: ItemMove,
): Promise<ListItem> {
  listPermissions.require(principal, "update");
  const { row, held } = await holdItem(principal, id);
  requireEdit(held);
  const targetId = move.listId ?? row.listId;
  const target = targetId === row.listId ? held : await holdList(principal, targetId);
  requireEdit(target);

  const sourceItems = (await itemsOf([row.listId])).get(row.listId) ?? [];
  const moving = subtreeOf(sourceItems, id);
  const targetItems =
    targetId === row.listId
      ? sourceItems
      : ((await itemsOf([targetId])).get(targetId) ?? []);
  if (move.parentId !== null) {
    if (!targetItems.some((item) => item.id === move.parentId)) {
      throw new DomainError("BAD_REQUEST", "That item is not on the list");
    }
    if (moving.has(move.parentId)) {
      throw new DomainError("BAD_REQUEST", "An item cannot go under itself");
    }
  }

  const siblings = targetItems
    .filter((item) => item.parentId === move.parentId && item.id !== id)
    .sort(byPosition);
  const index = Math.min(move.index, siblings.length);
  const order = [
    ...siblings.slice(0, index).map((s) => s.id),
    id,
    ...siblings.slice(index).map((s) => s.id),
  ];
  const db = getDb();
  await db.batch([
    db
      .update(listItem)
      .set({ listId: targetId, parentId: move.parentId, updatedAt: new Date() })
      .where(eq(listItem.id, id)),
    ...order.map((itemId, position) =>
      db.update(listItem).set({ position }).where(eq(listItem.id, itemId)),
    ),
  ]);
  if (targetId !== row.listId) {
    const under = [...moving].filter((itemId) => itemId !== id);
    for (const chunk of chunks(under)) {
      await db
        .update(listItem)
        .set({ listId: targetId })
        .where(inArray(listItem.id, chunk));
    }
    // Someone who does not see the new list is no longer assigned.
    const seeing = new Set([target.row.creatorId, ...target.shares.map((s) => s.userId)]);
    for (const chunk of chunks([...moving])) {
      const assigned = await db
        .select()
        .from(listItemAssignee)
        .where(inArray(listItemAssignee.itemId, chunk));
      const stale = assigned.filter((a) => !seeing.has(a.userId)).map((a) => a.id);
      if (stale.length > 0) {
        await db.delete(listItemAssignee).where(inArray(listItemAssignee.id, stale));
      }
    }
    await touch(row.listId);
    await rearmAlarms("item", [...moving]);
  }
  await touch(targetId);
  log.info("list item moved", {
    itemId: id,
    listId: targetId,
    parentId: move.parentId,
    index,
    userId: principal.userId,
  });
  return getItem(principal, id);
}

/** Removes an item and the items under it. */
export async function removeItem(principal: Principal, id: string): Promise<void> {
  listPermissions.require(principal, "update");
  const { row, held } = await holdItem(principal, id);
  requireEdit(held);
  const items = (await itemsOf([row.listId])).get(row.listId) ?? [];
  await deleteItems([...subtreeOf(items, id)]);
  await touch(row.listId);
  log.info("list item removed", { itemId: id, userId: principal.userId });
}

/** The item, when the caller sees its list. */
export async function getItem(principal: Principal, id: string): Promise<ListItem> {
  const { row } = await holdItem(principal, id);
  return toItem(row, (await assigneesOf([id])).get(id) ?? []);
}

// ---------------------------------------------------------------- alarms

/** The caller's own alarm on an item. */
export async function getItemAlarm(principal: Principal, id: string): Promise<Alarm> {
  await holdItem(principal, id);
  return { minutesBefore: await alarmMinutesOf("item", id, principal.userId) };
}

/**
 * Sets, changes or (null) removes the caller's own alarm on an item they see:
 * a reminder that long before its due day ends. Others are unaffected.
 */
export async function setItemAlarm(
  principal: Principal,
  id: string,
  minutesBefore: Alarm["minutesBefore"],
): Promise<Alarm> {
  await holdItem(principal, id);
  await setAlarm("item", id, principal.userId, minutesBefore);
  return { minutesBefore };
}

/**
 * The member's ring on the item when it is later than `after`: before its due
 * day ends, in the zone of their latest subscribed device. Null when they set
 * no alarm, or it is done, has no due day or is past; an item that is gone,
 * or whose list they no longer see, loses the alarm. It acts for no one.
 */
export async function nextItemRing(
  itemId: string,
  userId: string,
  after: number,
): Promise<AlarmRing | null> {
  const minutes = await alarmMinutesOf("item", itemId, userId);
  if (minutes === null) return null;
  const db = getDb();
  const row = await db.select().from(listItem).where(eq(listItem.id, itemId)).get();
  const owner = row
    ? await db.select().from(list).where(eq(list.id, row.listId)).get()
    : undefined;
  const shared = row
    ? await db
        .select({ id: listShare.id })
        .from(listShare)
        .where(and(eq(listShare.listId, row.listId), eq(listShare.userId, userId)))
        .get()
    : undefined;
  if (!row || !owner || !(owner.creatorId === userId || shared)) {
    await forgetAlarm("item", itemId, userId);
    return null;
  }
  if (row.completedAt || !row.dueDate) return null;
  // The due day ends at the next day's midnight, where the member is.
  const zone = (await timeZoneOf(userId)) ?? "UTC";
  const at = addDays(parseISO(row.dueDate, { in: tz(zone) }), 1).getTime();
  const ringAt = at - minutes * 60_000;
  if (ringAt <= after) return null;
  return {
    ringAt,
    at,
    muted: false,
    message: {
      title: row.title,
      body: `Due today · ${owner.name}`,
      url: `/lists/${row.listId}`,
      tag: `item:${row.id}`,
    },
  };
}

// ---------------------------------------------------------------- access

/** Every list the caller made or was given. */
async function heldLists(principal: Principal): Promise<Held[]> {
  const db = getDb();
  const given = db
    .select({ listId: listShare.listId })
    .from(listShare)
    .where(eq(listShare.userId, principal.userId));
  const rows = await db
    .select()
    .from(list)
    .where(or(eq(list.creatorId, principal.userId), inArray(list.id, given)));
  const shares = await sharesOf(rows.map((row) => row.id));
  return rows.map((row) => held(principal, row, shares.get(row.id) ?? []));
}

/** The list, when the caller made it or was given it; not found otherwise. */
async function holdList(principal: Principal, id: string): Promise<Held> {
  listPermissions.require(principal, "view");
  const row = await getDb().select().from(list).where(eq(list.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "List not found");
  const h = held(principal, row, (await sharesOf([id])).get(id) ?? []);
  if (h.mine.length === 0) throw new DomainError("NOT_FOUND", "List not found");
  return h;
}

/** The item and its list, when the caller sees the list; not found otherwise. */
async function holdItem(
  principal: Principal,
  id: string,
): Promise<{ row: ItemRow; held: Held }> {
  listPermissions.require(principal, "view");
  const row = await getDb().select().from(listItem).where(eq(listItem.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Item not found");
  try {
    return { row, held: await holdList(principal, row.listId) };
  } catch (err) {
    if (err instanceof DomainError && err.code === "NOT_FOUND") {
      throw new DomainError("NOT_FOUND", "Item not found");
    }
    throw err;
  }
}

/** What the caller may do with the list: everything when they made it, their share's otherwise, nothing when it is not theirs. */
function held(principal: Principal, row: ListRow, shares: ShareRow[]): Held {
  if (row.creatorId === principal.userId) return { row, shares, mine: EVERYTHING };
  const share = shares.find((s) => s.userId === principal.userId);
  return { row, shares, mine: share ? permissionsOf(share.permissions) : [] };
}

function requireEdit(h: Held): void {
  if (!h.mine.includes("edit")) {
    throw new DomainError(
      "FORBIDDEN",
      "This list was shared with you to view; ask whoever made it to let you edit it",
    );
  }
}

function requireShare(h: Held): void {
  if (!h.mine.includes("share")) {
    throw new DomainError(
      "FORBIDDEN",
      "This list was not shared with you to share; ask whoever made it",
    );
  }
}

/** Assignees as given, limited to people who see the list. */
function assignable(h: Held, assignees: readonly string[]): string[] {
  const seeing = new Set([h.row.creatorId, ...h.shares.map((s) => s.userId)]);
  return [...new Set(assignees)].filter((userId) => seeing.has(userId));
}

// ---------------------------------------------------------------- rows

/** Shares as given, without the creator, of household members only. */
async function resolveShares(creatorId: string, sharedWith: readonly string[]) {
  return (await knownUserIds(sharedWith)).filter((id) => id !== creatorId);
}

/** A share's permissions as stored: the known ones named, and view always. */
function permissionsOf(named: readonly SharePermission[] = []): SharePermission[] {
  return EVERYTHING.filter((p) => p === "view" || named.includes(p));
}

function grantedOf(shares: ShareRow[]): Record<string, SharePermission[]> {
  return Object.fromEntries(shares.map((s) => [s.userId, permissionsOf(s.permissions)]));
}

function differs(sent: readonly string[], held: readonly string[]): boolean {
  const a = new Set(sent);
  const b = new Set(held);
  return a.size !== b.size || [...a].some((id) => !b.has(id));
}

async function writeShares(
  listId: string,
  sharedWith: string[],
  granted: Record<string, SharePermission[]>,
): Promise<void> {
  if (sharedWith.length === 0) return;
  await getDb()
    .insert(listShare)
    .values(
      sharedWith.map((userId) => ({
        id: newEntityId("LIST_SHARE"),
        listId,
        userId,
        permissions: permissionsOf(granted[userId]),
      })),
    );
}

async function writeAssignees(itemId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await getDb()
    .insert(listItemAssignee)
    .values(
      userIds.map((userId) => ({
        id: newEntityId("LIST_ITEM_ASSIGNEE"),
        itemId,
        userId,
      })),
    );
}

async function deleteItems(ids: string[]): Promise<void> {
  const db = getDb();
  for (const chunk of chunks(ids)) {
    await db.delete(listItemAssignee).where(inArray(listItemAssignee.itemId, chunk));
    await db.delete(listItem).where(inArray(listItem.id, chunk));
  }
  await dropAlarms("item", ids);
}

/** The list was changed now: it comes first among the caller's lists. */
async function touch(listId: string): Promise<void> {
  await getDb().update(list).set({ updatedAt: new Date() }).where(eq(list.id, listId));
}

async function sharesOf(listIds: string[]): Promise<Map<string, ShareRow[]>> {
  const out = new Map<string, ShareRow[]>();
  for (const chunk of chunks(listIds)) {
    for (const row of await getDb()
      .select()
      .from(listShare)
      .where(inArray(listShare.listId, chunk))) {
      out.set(row.listId, [...(out.get(row.listId) ?? []), row]);
    }
  }
  return out;
}

/** Each list's items, as rows with their assignees. */
async function itemsOf(listIds: string[]): Promise<Map<string, ListItem[]>> {
  const rows: ItemRow[] = [];
  for (const chunk of chunks(listIds)) {
    rows.push(
      ...(await getDb().select().from(listItem).where(inArray(listItem.listId, chunk))),
    );
  }
  const assignees = await assigneesOf(rows.map((r) => r.id));
  const out = new Map<string, ListItem[]>();
  for (const row of rows) {
    out.set(row.listId, [
      ...(out.get(row.listId) ?? []),
      toItem(row, assignees.get(row.id) ?? []),
    ]);
  }
  return out;
}

async function assigneesOf(itemIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const chunk of chunks(itemIds)) {
    for (const row of await getDb()
      .select()
      .from(listItemAssignee)
      .where(inArray(listItemAssignee.itemId, chunk))) {
      out.set(row.itemId, [...(out.get(row.itemId) ?? []), row.userId]);
    }
  }
  return out;
}

/** The item's id and every id under it. */
function subtreeOf(
  items: { id: string; parentId: string | null }[],
  id: string,
): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      if (item.parentId && out.has(item.parentId) && !out.has(item.id)) {
        out.add(item.id);
        grew = true;
      }
    }
  }
  return out;
}

function chunks<T>(values: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += ID_CHUNK)
    out.push(values.slice(i, i + ID_CHUNK));
  return out;
}

function byPosition(
  a: { position: number; createdAt: number },
  b: { position: number; createdAt: number },
) {
  return a.position - b.position || a.createdAt - b.createdAt;
}

function toItem(row: ItemRow, assignees: string[]): ListItem {
  return {
    id: row.id,
    listId: row.listId,
    parentId: row.parentId,
    position: row.position,
    title: row.title,
    description: row.description,
    creatorId: row.creatorId,
    dueDate: row.dueDate,
    completedAt: row.completedAt?.getTime() ?? null,
    assignees,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function listFieldsOf(h: Held) {
  return {
    id: h.row.id,
    name: h.row.name,
    color: h.row.color,
    creatorId: h.row.creatorId,
    sharedWith: h.shares.map((s) => s.userId),
    permissions: grantedOf(h.shares),
    myPermissions: h.mine,
    createdAt: h.row.createdAt.getTime(),
    updatedAt: h.row.updatedAt.getTime(),
  };
}

