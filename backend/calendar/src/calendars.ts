import { and, asc, eq, inArray } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import {
  calendar,
  calendarEvent,
  calendarEventShare,
  calendarShare,
} from "@backend/db-models/calendar";
import { getDb } from "@backend/db-models/db";
import { knownUserIds } from "@backend/household/users";
import { CALENDAR_COLORS, type Calendar } from "@shared/contract/app/calendar";
import { calendarPermissions } from "./permissions";

const log = logger("calendar/calendars");

export type CalendarRow = typeof calendar.$inferSelect;

const DEFAULT_NAME = "Matron";

/** A calendar shared with the caller, with the colour they see it in. */
export interface ViewedCalendar {
  row: CalendarRow;
  color: string;
}

/** The caller's calendars: their own (default first, imported last), then those shared with them. */
export async function listCalendars(principal: Principal): Promise<Calendar[]> {
  calendarPermissions.require(principal, "view");
  await defaultCalendarOf(principal.userId);
  const db = getDb();
  const own = await db
    .select()
    .from(calendar)
    .where(eq(calendar.ownerId, principal.userId))
    .orderBy(asc(calendar.createdAt));
  const shares = await sharesOfCalendars(own.map((c) => c.id));
  const viewed = await viewedCalendarsOf(principal.userId);
  return [
    ...own
      .sort(
        (a, b) =>
          Number(b.isDefault) - Number(a.isDefault) ||
          Number(a.source === "google") - Number(b.source === "google"),
      )
      .map((row) => toCalendar(row, shares.get(row.id) ?? [])),
    ...[...viewed.values()].map(({ row, color }) => toViewed(row, color)),
  ];
}

export async function createCalendar(
  principal: Principal,
  input: { name: string; color: string },
): Promise<Calendar> {
  calendarPermissions.require(principal, "create");
  await defaultCalendarOf(principal.userId);
  const [row] = await getDb()
    .insert(calendar)
    .values({
      id: newEntityId("CALENDAR"),
      ownerId: principal.userId,
      name: input.name,
      color: input.color,
      source: "matron",
    })
    .returning();
  log.info("calendar created", { calendarId: row!.id, userId: principal.userId });
  return toCalendar(row!, []);
}

export interface CalendarChanges {
  name?: string;
  color?: string;
  isDefault?: true;
  receivesShared?: true;
  sharedWith?: string[];
}

/**
 * The owner renames, recolours or shares a calendar, or makes a Matron one the
 * default or the one for shared events. A viewer sets only their own colour.
 */
export async function updateCalendar(
  principal: Principal,
  id: string,
  changes: CalendarChanges,
): Promise<Calendar> {
  calendarPermissions.require(principal, "update");
  const db = getDb();
  const viewed = (await viewedCalendarsOf(principal.userId)).get(id);
  if (viewed) {
    const { color, ...rest } = changes;
    if (Object.values(rest).some((value) => value !== undefined)) {
      throw new DomainError(
        "FORBIDDEN",
        "This calendar is shared with you read-only; only your colour for it changes",
      );
    }
    if (color) {
      await db
        .update(calendarShare)
        .set({ color, updatedAt: new Date() })
        .where(
          and(
            eq(calendarShare.calendarId, id),
            eq(calendarShare.userId, principal.userId),
          ),
        );
    }
    log.info("shared calendar recoloured", { calendarId: id, userId: principal.userId });
    return toViewed(viewed.row, color ?? viewed.color);
  }

  const current = await ownCalendar(principal, id);
  if ((changes.isDefault || changes.receivesShared) && current.source !== "matron") {
    throw new DomainError("BAD_REQUEST", "Only a Matron calendar takes new events");
  }
  if (changes.isDefault && !current.isDefault) {
    await db
      .update(calendar)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(calendar.ownerId, principal.userId), eq(calendar.isDefault, true)));
  }
  if (changes.receivesShared && !current.receivesShared) {
    await db
      .update(calendar)
      .set({ receivesShared: false, updatedAt: new Date() })
      .where(
        and(eq(calendar.ownerId, principal.userId), eq(calendar.receivesShared, true)),
      );
  }
  const [row] = await db
    .update(calendar)
    .set({
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.color !== undefined && { color: changes.color }),
      ...(changes.isDefault && { isDefault: true }),
      ...(changes.receivesShared && { receivesShared: true }),
      updatedAt: new Date(),
    })
    .where(eq(calendar.id, id))
    .returning();
  if (changes.sharedWith) {
    calendarPermissions.require(principal, "share");
    await replaceShares(id, principal.userId, changes.sharedWith);
  }
  log.info("calendar updated", {
    calendarId: id,
    shared: changes.sharedWith?.length,
    userId: principal.userId,
  });
  return toCalendar(row!, (await sharesOfCalendars([id])).get(id) ?? []);
}

/**
 * The owner removes a Matron calendar with its events; Google calendars go by
 * deselecting them. A viewer stops seeing a calendar shared with them.
 */
export async function removeCalendar(principal: Principal, id: string): Promise<void> {
  calendarPermissions.require(principal, "remove");
  if ((await viewedCalendarsOf(principal.userId)).has(id)) {
    await getDb()
      .delete(calendarShare)
      .where(
        and(eq(calendarShare.calendarId, id), eq(calendarShare.userId, principal.userId)),
      );
    log.info("shared calendar left", { calendarId: id, userId: principal.userId });
    return;
  }
  const current = await ownCalendar(principal, id);
  if (current.isDefault) {
    throw new DomainError("CONFLICT", "Make another calendar the default first");
  }
  if (current.source !== "matron") {
    throw new DomainError(
      "BAD_REQUEST",
      "Stop importing it from your Google Calendar settings instead",
    );
  }
  await deleteCalendars([id]);
  log.info("calendar removed", { calendarId: id, userId: principal.userId });
}

/** The owner's default Matron calendar, made on first need. */
export async function defaultCalendarOf(ownerId: string): Promise<CalendarRow> {
  const db = getDb();
  const existing = await db
    .select()
    .from(calendar)
    .where(and(eq(calendar.ownerId, ownerId), eq(calendar.isDefault, true)))
    .get();
  if (existing) return existing;
  // The partial unique index on (owner_id) WHERE is_default keeps a race to one row.
  await db
    .insert(calendar)
    .values({
      id: newEntityId("CALENDAR"),
      ownerId,
      name: DEFAULT_NAME,
      color: CALENDAR_COLORS[0],
      source: "matron",
      isDefault: true,
    })
    .onConflictDoNothing();
  return (await db
    .select()
    .from(calendar)
    .where(and(eq(calendar.ownerId, ownerId), eq(calendar.isDefault, true)))
    .get())!;
}

/** Where events others share with the owner show unless placed: their calendar for shared events, else the default. */
export async function sharedTargetOf(ownerId: string): Promise<CalendarRow> {
  const chosen = await getDb()
    .select()
    .from(calendar)
    .where(and(eq(calendar.ownerId, ownerId), eq(calendar.receivesShared, true)))
    .get();
  return chosen ?? defaultCalendarOf(ownerId);
}

/**
 * The Matron calendar a new or moved event of `ownerId` goes to: the one named,
 * which must be theirs and made in Matron, or their default.
 */
export async function writableCalendarOf(
  ownerId: string,
  calendarId: string | undefined,
): Promise<CalendarRow> {
  if (!calendarId) return defaultCalendarOf(ownerId);
  const row = await getDb()
    .select()
    .from(calendar)
    .where(and(eq(calendar.id, calendarId), eq(calendar.ownerId, ownerId)))
    .get();
  if (!row) throw new DomainError("NOT_FOUND", "Calendar not found");
  if (row.source !== "matron") {
    throw new DomainError(
      "BAD_REQUEST",
      "Imported calendars are read-only; add the event in Google Calendar",
    );
  }
  return row;
}

/** Calendars by id. */
export async function calendarsById(ids: string[]): Promise<Map<string, CalendarRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await getDb().select().from(calendar).where(inArray(calendar.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
}

/** The calendars shared with the user, by id, each in the colour they chose or the owner's. */
export async function viewedCalendarsOf(
  userId: string,
): Promise<Map<string, ViewedCalendar>> {
  const rows = await getDb()
    .select({ row: calendar, color: calendarShare.color })
    .from(calendarShare)
    .innerJoin(calendar, eq(calendar.id, calendarShare.calendarId))
    .where(eq(calendarShare.userId, userId))
    .orderBy(asc(calendarShare.createdAt));
  return new Map(
    rows.map(({ row, color }) => [row.id, { row, color: color ?? row.color }]),
  );
}

/** The owner's imported calendars from `source`. */
export async function importedCalendarsOf(
  ownerId: string,
  source: "google",
): Promise<CalendarRow[]> {
  return getDb()
    .select()
    .from(calendar)
    .where(and(eq(calendar.ownerId, ownerId), eq(calendar.source, source)));
}

/** Adds an imported calendar for the owner, or returns the one already there. */
export async function ensureImportedCalendar(
  ownerId: string,
  source: "google",
  externalId: string,
  name: string,
  color: string,
): Promise<CalendarRow> {
  const db = getDb();
  await db
    .insert(calendar)
    .values({
      id: newEntityId("CALENDAR"),
      ownerId,
      name: name.slice(0, 80) || "Google",
      color,
      source,
      externalId,
    })
    .onConflictDoNothing();
  return (await db
    .select()
    .from(calendar)
    .where(
      and(
        eq(calendar.ownerId, ownerId),
        eq(calendar.source, source),
        eq(calendar.externalId, externalId),
      ),
    )
    .get())!;
}

/**
 * Deletes calendars with their events, the events' shares and who the
 * calendars were shared with. Events others placed in them go back to those
 * members' calendar for shared events.
 */
export async function deleteCalendars(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  const events = db
    .select({ id: calendarEvent.id })
    .from(calendarEvent)
    .where(inArray(calendarEvent.calendarId, ids));
  await db.batch([
    db.delete(calendarEventShare).where(inArray(calendarEventShare.eventId, events)),
    db
      .update(calendarEventShare)
      .set({ calendarId: null })
      .where(inArray(calendarEventShare.calendarId, ids)),
    db.delete(calendarShare).where(inArray(calendarShare.calendarId, ids)),
    db.delete(calendarEvent).where(inArray(calendarEvent.calendarId, ids)),
    db.delete(calendar).where(inArray(calendar.id, ids)),
  ]);
}

/** Shares the calendar with exactly these members, keeping each remaining viewer's colour. */
async function replaceShares(
  calendarId: string,
  ownerId: string,
  userIds: string[],
): Promise<void> {
  const wanted = new Set(
    (await knownUserIds([...new Set(userIds)])).filter((id) => id !== ownerId),
  );
  const db = getDb();
  const current = await db
    .select({ userId: calendarShare.userId })
    .from(calendarShare)
    .where(eq(calendarShare.calendarId, calendarId));
  const have = new Set(current.map((s) => s.userId));
  const gone = [...have].filter((id) => !wanted.has(id));
  const added = [...wanted].filter((id) => !have.has(id));
  if (gone.length) {
    await db
      .delete(calendarShare)
      .where(
        and(
          eq(calendarShare.calendarId, calendarId),
          inArray(calendarShare.userId, gone),
        ),
      );
  }
  if (added.length) {
    await db
      .insert(calendarShare)
      .values(
        added.map((userId) => ({
          id: newEntityId("CALENDAR_SHARE"),
          calendarId,
          userId,
        })),
      )
      .onConflictDoNothing();
  }
}

async function sharesOfCalendars(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const rows = await getDb()
    .select({ calendarId: calendarShare.calendarId, userId: calendarShare.userId })
    .from(calendarShare)
    .where(inArray(calendarShare.calendarId, ids));
  for (const row of rows) {
    out.set(row.calendarId, [...(out.get(row.calendarId) ?? []), row.userId]);
  }
  return out;
}

async function ownCalendar(principal: Principal, id: string): Promise<CalendarRow> {
  const row = await getDb()
    .select()
    .from(calendar)
    .where(and(eq(calendar.id, id), eq(calendar.ownerId, principal.userId)))
    .get();
  if (!row) throw new DomainError("NOT_FOUND", "Calendar not found");
  return row;
}

function toCalendar(row: CalendarRow, sharedWith: string[]): Calendar {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    color: row.color,
    source: row.source,
    access: "owner",
    isDefault: row.isDefault,
    receivesShared: row.receivesShared,
    sharedWith,
  };
}

function toViewed(row: CalendarRow, color: string): Calendar {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    color,
    source: row.source,
    access: "viewer",
    isDefault: false,
    receivesShared: false,
    sharedWith: [],
  };
}
