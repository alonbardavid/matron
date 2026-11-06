import { and, asc, eq, inArray } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { calendar, calendarEvent, calendarEventShare } from "@backend/db-models/calendar";
import { getDb } from "@backend/db-models/db";
import { CALENDAR_COLORS, type Calendar } from "@shared/contract/app/calendar";
import { calendarPermissions } from "./permissions";

const log = logger("calendar/calendars");

export type CalendarRow = typeof calendar.$inferSelect;

const DEFAULT_NAME = "Matron";

/** The caller's calendars: the default first, then Matron ones, then imported ones. */
export async function listCalendars(principal: Principal): Promise<Calendar[]> {
  calendarPermissions.require(principal, "view");
  await defaultCalendarOf(principal.userId);
  const rows = await getDb()
    .select()
    .from(calendar)
    .where(eq(calendar.ownerId, principal.userId))
    .orderBy(asc(calendar.createdAt));
  return rows
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        Number(a.source === "google") - Number(b.source === "google"),
    )
    .map(toCalendar);
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
  return toCalendar(row!);
}

/** Renames or recolours one of the caller's calendars, or makes a Matron one the default. */
export async function updateCalendar(
  principal: Principal,
  id: string,
  changes: { name?: string; color?: string; isDefault?: true },
): Promise<Calendar> {
  calendarPermissions.require(principal, "update");
  const current = await ownCalendar(principal, id);
  const db = getDb();
  if (changes.isDefault && !current.isDefault) {
    if (current.source !== "matron") {
      throw new DomainError("BAD_REQUEST", "New events go to a Matron calendar");
    }
    await db
      .update(calendar)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(calendar.ownerId, principal.userId), eq(calendar.isDefault, true)));
  }
  const [row] = await db
    .update(calendar)
    .set({
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.color !== undefined && { color: changes.color }),
      ...(changes.isDefault && { isDefault: true }),
      updatedAt: new Date(),
    })
    .where(eq(calendar.id, id))
    .returning();
  log.info("calendar updated", { calendarId: id, userId: principal.userId });
  return toCalendar(row!);
}

/** Removes one of the caller's Matron calendars and its events. Google calendars go by deselecting them. */
export async function removeCalendar(principal: Principal, id: string): Promise<void> {
  calendarPermissions.require(principal, "remove");
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

/** Calendars by id, for the colour and source of the events in them. */
export async function calendarsById(ids: string[]): Promise<Map<string, CalendarRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await getDb().select().from(calendar).where(inArray(calendar.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
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

/** Deletes calendars with their events and the events' shares. */
export async function deleteCalendars(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  const events = db
    .select({ id: calendarEvent.id })
    .from(calendarEvent)
    .where(inArray(calendarEvent.calendarId, ids));
  await db.batch([
    db.delete(calendarEventShare).where(inArray(calendarEventShare.eventId, events)),
    db.delete(calendarEvent).where(inArray(calendarEvent.calendarId, ids)),
    db.delete(calendar).where(inArray(calendar.id, ids)),
  ]);
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

export function toCalendar(row: CalendarRow): Calendar {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    color: row.color,
    source: row.source,
    isDefault: row.isDefault,
  };
}
