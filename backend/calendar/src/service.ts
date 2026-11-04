import { and, eq, gte, inArray, lt, or } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { calendarEvent, calendarEventShare } from "@backend/db-models/calendar";
import { getDb } from "@backend/db-models/db";
import { knownUserIds } from "@backend/household/users";
import type {
  CalendarEvent,
  CalendarEventCreate,
  CalendarEventUpdate,
  Occurrence,
  Recurrence,
} from "@shared/contract/app/calendar";
import { dayBefore, expandSeries } from "./recurrence";
import { eventPermissions } from "./permissions";

const log = logger("calendar/service");

type EventRow = typeof calendarEvent.$inferSelect;
type ShareRow = typeof calendarEventShare.$inferSelect;

/** Everything on the caller's calendar between two instants, series expanded. */
export async function listOccurrences(
  principal: Principal,
  from: number,
  to: number,
): Promise<Occurrence[]> {
  eventPermissions.require(principal, "view");
  if (to <= from) return [];
  const db = getDb();
  const mine = db
    .select({ eventId: calendarEventShare.eventId })
    .from(calendarEventShare)
    .where(eq(calendarEventShare.userId, principal.userId));
  const visible = or(
    eq(calendarEvent.creatorId, principal.userId),
    inArray(calendarEvent.id, mine),
  );
  const rows = await db
    .select()
    .from(calendarEvent)
    .where(
      and(
        visible,
        // Single events in the window; any series that started before the window ends.
        or(
          and(
            lt(calendarEvent.startAt, new Date(to)),
            gte(calendarEvent.endAt, new Date(from)),
          ),
          and(
            lt(calendarEvent.startAt, new Date(to)),
            inArray(calendarEvent.recurrenceFrequency, ["weekly", "monthly"]),
          ),
        ),
      ),
    );
  const out: Occurrence[] = [];
  for (const row of rows) {
    const recurrence = toRecurrence(row);
    if (!recurrence) {
      out.push(
        toOccurrence(row, row.id, row.startAt.getTime(), row.endAt.getTime(), false),
      );
      continue;
    }
    for (const window of expandSeries(
      {
        startAt: row.startAt.getTime(),
        endAt: row.endAt.getTime(),
        timeZone: row.timeZone,
        recurrence,
      },
      from,
      to,
    )) {
      out.push(
        toOccurrence(row, `${row.id}:${window.day}`, window.startAt, window.endAt, true),
      );
    }
  }
  return out.sort((a, b) => a.startAt - b.startAt);
}

/** The event, when the caller created it or was given it. */
export async function getEvent(principal: Principal, id: string): Promise<CalendarEvent> {
  eventPermissions.require(principal, "view");
  const row = await getDb()
    .select()
    .from(calendarEvent)
    .where(eq(calendarEvent.id, id))
    .get();
  if (!row) throw new DomainError("NOT_FOUND", "Event not found");
  const item = toEvent(row, (await sharesOf([id])).get(id) ?? []);
  if (!canSee(principal, item)) throw new DomainError("NOT_FOUND", "Event not found");
  return item;
}

export async function createEvent(
  principal: Principal,
  input: CalendarEventCreate,
): Promise<CalendarEvent> {
  eventPermissions.require(principal, "create");
  checkTimes(input.startAt, input.endAt);
  const id = newEntityId("CALENDAR_EVENT");
  const { sharedWith, attendees } = await resolvePeople(
    principal.userId,
    input.sharedWith ?? [],
    input.attendees,
  );
  const [row] = await getDb()
    .insert(calendarEvent)
    .values({
      id,
      title: input.title,
      description: input.description ?? "",
      creatorId: principal.userId,
      allDay: input.allDay,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      timeZone: input.timeZone,
      ...recurrenceColumns(input.recurrence ?? null),
    })
    .returning();
  await writeShares(id, sharedWith, attendees);
  log.info("event created", { eventId: id, userId: principal.userId });
  return toEvent(row!, (await sharesOf([id])).get(id) ?? []);
}

export async function updateEvent(
  principal: Principal,
  id: string,
  changes: CalendarEventUpdate,
): Promise<CalendarEvent> {
  eventPermissions.require(principal, "update");
  const sharing = Boolean(changes.sharedWith || changes.attendees);
  if (sharing) eventPermissions.require(principal, "share");
  const current = await getEvent(principal, id);
  if (sharing && !canManage(principal, current)) {
    throw new DomainError(
      "FORBIDDEN",
      "Only the event's creator changes who it is shared with",
    );
  }
  const startAt = changes.startAt ?? current.startAt;
  const endAt = changes.endAt ?? current.endAt;
  checkTimes(startAt, endAt);
  const db = getDb();
  const [row] = await db
    .update(calendarEvent)
    .set({
      ...(changes.title !== undefined && { title: changes.title }),
      ...(changes.description !== undefined && { description: changes.description }),
      ...(changes.allDay !== undefined && { allDay: changes.allDay }),
      startAt: new Date(startAt),
      endAt: new Date(endAt),
      ...(changes.timeZone !== undefined && { timeZone: changes.timeZone }),
      ...(changes.recurrence !== undefined && recurrenceColumns(changes.recurrence)),
      updatedAt: new Date(),
    })
    .where(eq(calendarEvent.id, id))
    .returning();
  if (changes.sharedWith || changes.attendees) {
    const { sharedWith, attendees } = await resolvePeople(
      current.creatorId,
      changes.sharedWith ?? current.sharedWith,
      changes.attendees ?? current.attendees,
    );
    await db.delete(calendarEventShare).where(eq(calendarEventShare.eventId, id));
    await writeShares(id, sharedWith, attendees);
  }
  log.info("event updated", { eventId: id, userId: principal.userId });
  return toEvent(row!, (await sharesOf([id])).get(id) ?? []);
}

/** Ends a series before `from`: what happened before that day stays on the calendar. */
export async function stopRecurrence(
  principal: Principal,
  id: string,
  from: string,
): Promise<CalendarEvent> {
  eventPermissions.require(principal, "update");
  const current = await getEvent(principal, id);
  if (!current.recurrence)
    throw new DomainError("CONFLICT", "This event does not repeat");
  const until = dayBefore(from);
  const [row] = await getDb()
    .update(calendarEvent)
    .set({ recurrenceUntil: until, recurrenceCount: null, updatedAt: new Date() })
    .where(eq(calendarEvent.id, id))
    .returning();
  log.info("recurrence stopped", { eventId: id, until, userId: principal.userId });
  return toEvent(row!, (await sharesOf([id])).get(id) ?? []);
}

export async function removeEvent(principal: Principal, id: string): Promise<void> {
  eventPermissions.require(principal, "remove");
  const current = await getEvent(principal, id);
  if (!canManage(principal, current)) {
    throw new DomainError("FORBIDDEN", "Only the event's creator removes it");
  }
  const db = getDb();
  await db.delete(calendarEventShare).where(eq(calendarEventShare.eventId, id));
  await db.delete(calendarEvent).where(eq(calendarEvent.id, id));
  log.info("event removed", { eventId: id, userId: principal.userId });
}

function checkTimes(startAt: number, endAt: number): void {
  if (endAt <= startAt)
    throw new DomainError("BAD_REQUEST", "An event must end after it starts");
}

function canSee(principal: Principal, item: CalendarEvent): boolean {
  return (
    item.creatorId === principal.userId || item.sharedWith.includes(principal.userId)
  );
}

function canManage(principal: Principal, item: CalendarEvent): boolean {
  return item.creatorId === principal.userId || principal.role === "owner";
}

/**
 * Attendees default to everyone shared with and the creator; anyone named as
 * attending is shared with as well, so they can see what they attend.
 */
async function resolvePeople(
  creatorId: string,
  sharedWith: readonly string[],
  attendees: readonly string[] | undefined,
): Promise<{ sharedWith: string[]; attendees: string[] }> {
  const shared = (await knownUserIds(sharedWith)).filter((id) => id !== creatorId);
  const attending =
    attendees === undefined
      ? [creatorId, ...shared]
      : await knownUserIds([...new Set(attendees)]);
  const everyone = [
    ...new Set([...shared, ...attending.filter((id) => id !== creatorId)]),
  ];
  return { sharedWith: everyone, attendees: attending };
}

async function writeShares(
  eventId: string,
  sharedWith: string[],
  attendees: string[],
): Promise<void> {
  const people = new Set([...sharedWith, ...attendees]);
  if (people.size === 0) return;
  await getDb()
    .insert(calendarEventShare)
    .values(
      [...people].map((userId) => ({
        id: newEntityId("CALENDAR_EVENT_SHARE"),
        eventId,
        userId,
        attendee: attendees.includes(userId),
      })),
    );
}

async function sharesOf(eventIds: string[]): Promise<Map<string, ShareRow[]>> {
  const out = new Map<string, ShareRow[]>();
  if (eventIds.length === 0) return out;
  const rows = await getDb()
    .select()
    .from(calendarEventShare)
    .where(inArray(calendarEventShare.eventId, eventIds));
  for (const row of rows) {
    const list = out.get(row.eventId) ?? [];
    list.push(row);
    out.set(row.eventId, list);
  }
  return out;
}

function recurrenceColumns(recurrence: Recurrence | null) {
  return {
    recurrenceFrequency: recurrence?.frequency ?? null,
    recurrenceDays: recurrence ? JSON.stringify(recurrence.days) : null,
    recurrenceUntil: recurrence?.until ?? null,
    recurrenceCount: recurrence?.count ?? null,
  };
}

function toRecurrence(row: EventRow): Recurrence | null {
  if (!row.recurrenceFrequency) return null;
  let days: number[] = [];
  try {
    const parsed: unknown = JSON.parse(row.recurrenceDays ?? "[]");
    if (Array.isArray(parsed))
      days = parsed.filter((d): d is number => typeof d === "number");
  } catch {
    days = [];
  }
  return {
    frequency: row.recurrenceFrequency,
    days,
    until: row.recurrenceUntil,
    count: row.recurrenceCount,
  };
}

function toEvent(row: EventRow, shares: ShareRow[]): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    creatorId: row.creatorId,
    allDay: row.allDay,
    startAt: row.startAt.getTime(),
    endAt: row.endAt.getTime(),
    timeZone: row.timeZone,
    recurrence: toRecurrence(row),
    sharedWith: shares.map((s) => s.userId).filter((id) => id !== row.creatorId),
    attendees: shares.filter((s) => s.attendee).map((s) => s.userId),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function toOccurrence(
  row: EventRow,
  id: string,
  startAt: number,
  endAt: number,
  recurring: boolean,
): Occurrence {
  return {
    id,
    eventId: row.id,
    title: row.title,
    allDay: row.allDay,
    startAt,
    endAt,
    recurring,
    creatorId: row.creatorId,
  };
}
