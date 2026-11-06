import { and, eq, gte, inArray, lt, or } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { calendar, calendarEvent, calendarEventShare } from "@backend/db-models/calendar";
import { getDb } from "@backend/db-models/db";
import { knownUserIds } from "@backend/household/users";
import {
  CALENDAR_COLORS,
  type CalendarEvent,
  type CalendarEventCreate,
  type CalendarEventUpdate,
  type Occurrence,
  type Recurrence,
} from "@shared/contract/app/calendar";
import {
  calendarsById,
  sharedTargetOf,
  viewedCalendarsOf,
  writableCalendarOf,
  type CalendarRow,
  type ViewedCalendar,
} from "./calendars";
import { dayBefore, expandSeries } from "./recurrence";
import { eventPermissions } from "./permissions";

const log = logger("calendar/service");

type EventRow = typeof calendarEvent.$inferSelect;
type ShareRow = typeof calendarEventShare.$inferSelect;

/** What the caller's calendars are, for where and in what colour each event shows to them. */
interface Viewer {
  userId: string;
  own: Map<string, CalendarRow>;
  viewed: Map<string, ViewedCalendar>;
  /** Where events shared with them show unless they placed one elsewhere. */
  sharedTarget: CalendarRow;
}

interface Placement {
  shownIn: string;
  color: string;
  access: "edit" | "read";
}

async function viewerOf(principal: Principal): Promise<Viewer> {
  const sharedTarget = await sharedTargetOf(principal.userId);
  const [own, viewed] = await Promise.all([
    getDb().select().from(calendar).where(eq(calendar.ownerId, principal.userId)),
    viewedCalendarsOf(principal.userId),
  ]);
  return {
    userId: principal.userId,
    own: new Map(own.map((row) => [row.id, row])),
    viewed,
    sharedTarget,
  };
}

/**
 * Where an event shows for the viewer: their own in its calendar; one shared
 * with them in the calendar they placed it in, else their calendar for shared
 * events; one they see through a shared calendar, read-only, in that calendar
 * and the colour they gave it. Null when they may not see it at all.
 */
function placementOf(
  viewer: Viewer,
  row: EventRow,
  mine: ShareRow | undefined,
): Placement | null {
  if (row.creatorId === viewer.userId) {
    const own = viewer.own.get(row.calendarId);
    return {
      shownIn: row.calendarId,
      color: own?.color ?? CALENDAR_COLORS[0],
      access: "edit",
    };
  }
  if (mine) {
    const target =
      (mine.calendarId && viewer.own.get(mine.calendarId)) || viewer.sharedTarget;
    return { shownIn: target.id, color: target.color, access: "edit" };
  }
  const viewed = viewer.viewed.get(row.calendarId);
  if (viewed) return { shownIn: row.calendarId, color: viewed.color, access: "read" };
  return null;
}

/** Everything on the caller's calendar between two instants, series expanded. */
export async function listOccurrences(
  principal: Principal,
  from: number,
  to: number,
): Promise<Occurrence[]> {
  eventPermissions.require(principal, "view");
  if (to <= from) return [];
  const db = getDb();
  const viewer = await viewerOf(principal);
  const mine = db
    .select({ eventId: calendarEventShare.eventId })
    .from(calendarEventShare)
    .where(eq(calendarEventShare.userId, principal.userId));
  const viewedIds = [...viewer.viewed.keys()];
  const visible = or(
    eq(calendarEvent.creatorId, principal.userId),
    inArray(calendarEvent.id, mine),
    ...(viewedIds.length ? [inArray(calendarEvent.calendarId, viewedIds)] : []),
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
  const [calendars, myShares] = await Promise.all([
    calendarsById(rows.map((row) => row.calendarId)),
    db
      .select()
      .from(calendarEventShare)
      .where(eq(calendarEventShare.userId, principal.userId)),
  ]);
  const shareOf = new Map(myShares.map((share) => [share.eventId, share]));
  const out: Occurrence[] = [];
  for (const row of rows) {
    const cal = calendars.get(row.calendarId);
    const placement = placementOf(viewer, row, shareOf.get(row.id));
    if (!placement) continue;
    const recurrence = toRecurrence(row);
    if (!recurrence) {
      out.push(
        toOccurrence(
          row,
          cal,
          placement,
          row.id,
          row.startAt.getTime(),
          row.endAt.getTime(),
          row.externalSeriesId !== null,
        ),
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
        toOccurrence(
          row,
          cal,
          placement,
          `${row.id}:${window.day}`,
          window.startAt,
          window.endAt,
          true,
        ),
      );
    }
  }
  return out.sort((a, b) => a.startAt - b.startAt);
}

/** The event, when the caller created it, was given it, or sees its calendar. */
export async function getEvent(principal: Principal, id: string): Promise<CalendarEvent> {
  eventPermissions.require(principal, "view");
  const row = await getDb()
    .select()
    .from(calendarEvent)
    .where(eq(calendarEvent.id, id))
    .get();
  if (!row) throw new DomainError("NOT_FOUND", "Event not found");
  return withShares(principal, row);
}

/** Shows an event shared with the caller in one of their Matron calendars, or (null) their calendar for shared events. */
export async function placeEvent(
  principal: Principal,
  id: string,
  calendarId: string | null,
): Promise<CalendarEvent> {
  eventPermissions.require(principal, "view");
  const current = await getEvent(principal, id);
  if (
    current.creatorId === principal.userId ||
    !current.sharedWith.includes(principal.userId)
  ) {
    throw new DomainError(
      "BAD_REQUEST",
      "Only an event someone shared with you is placed in your calendars",
    );
  }
  const target = calendarId
    ? (await writableCalendarOf(principal.userId, calendarId)).id
    : null;
  await getDb()
    .update(calendarEventShare)
    .set({ calendarId: target })
    .where(
      and(
        eq(calendarEventShare.eventId, id),
        eq(calendarEventShare.userId, principal.userId),
      ),
    );
  log.info("shared event placed", {
    eventId: id,
    calendarId: target,
    userId: principal.userId,
  });
  return getEvent(principal, id);
}

export async function createEvent(
  principal: Principal,
  input: CalendarEventCreate,
): Promise<CalendarEvent> {
  eventPermissions.require(principal, "create");
  checkTimes(input.startAt, input.endAt);
  const target = await writableCalendarOf(principal.userId, input.calendarId);
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
      calendarId: target.id,
      ...recurrenceColumns(input.recurrence ?? null),
    })
    .returning();
  await writeShares(id, sharedWith, attendees);
  log.info("event created", {
    eventId: id,
    calendarId: target.id,
    userId: principal.userId,
  });
  return withShares(principal, row!);
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
  requireEditable(current);
  if (sharing && !canManage(principal, current)) {
    throw new DomainError(
      "FORBIDDEN",
      "Only the event's creator changes who it is shared with",
    );
  }
  if (current.source !== "matron") {
    // An imported event is the source's: only who it is shared with is Matron's own.
    const { sharedWith: _shared, attendees: _attending, ...rest } = changes;
    if (Object.values(rest).some((value) => value !== undefined)) {
      throw new DomainError(
        "BAD_REQUEST",
        "This event comes from Google Calendar; change it there",
      );
    }
  }
  let calendarId: string | undefined;
  if (changes.calendarId !== undefined && changes.calendarId !== current.calendarId) {
    if (!canManage(principal, current)) {
      throw new DomainError("FORBIDDEN", "Only the event's creator moves it");
    }
    calendarId = (await writableCalendarOf(current.creatorId, changes.calendarId)).id;
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
      ...(calendarId !== undefined && { calendarId }),
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
    // Each remaining recipient keeps the calendar they placed it in.
    const placed = new Map(
      ((await sharesOf([id])).get(id) ?? []).map((share) => [
        share.userId,
        share.calendarId,
      ]),
    );
    await db.delete(calendarEventShare).where(eq(calendarEventShare.eventId, id));
    await writeShares(id, sharedWith, attendees, placed);
  }
  log.info("event updated", { eventId: id, userId: principal.userId });
  return withShares(principal, row!);
}

/** Ends a series before `from`: what happened before that day stays on the calendar. */
export async function stopRecurrence(
  principal: Principal,
  id: string,
  from: string,
): Promise<CalendarEvent> {
  eventPermissions.require(principal, "update");
  const current = await getEvent(principal, id);
  requireEditable(current);
  refuseImported(current);
  if (!current.recurrence)
    throw new DomainError("CONFLICT", "This event does not repeat");
  const until = dayBefore(from);
  const [row] = await getDb()
    .update(calendarEvent)
    .set({ recurrenceUntil: until, recurrenceCount: null, updatedAt: new Date() })
    .where(eq(calendarEvent.id, id))
    .returning();
  log.info("recurrence stopped", { eventId: id, until, userId: principal.userId });
  return withShares(principal, row!);
}

export async function removeEvent(principal: Principal, id: string): Promise<void> {
  eventPermissions.require(principal, "remove");
  const current = await getEvent(principal, id);
  requireEditable(current);
  refuseImported(current);
  if (!canManage(principal, current)) {
    throw new DomainError("FORBIDDEN", "Only the event's creator removes it");
  }
  const db = getDb();
  await db.delete(calendarEventShare).where(eq(calendarEventShare.eventId, id));
  await db.delete(calendarEvent).where(eq(calendarEvent.id, id));
  log.info("event removed", { eventId: id, userId: principal.userId });
}

function refuseImported(item: CalendarEvent): void {
  if (item.source !== "matron") {
    throw new DomainError(
      "BAD_REQUEST",
      "This event comes from Google Calendar; change it there",
    );
  }
}

function requireEditable(item: CalendarEvent): void {
  if (item.access !== "edit") {
    throw new DomainError("FORBIDDEN", "This calendar is shared with you read-only");
  }
}

/** The event as the caller sees it; NOT_FOUND when they may not see it. */
async function withShares(principal: Principal, row: EventRow): Promise<CalendarEvent> {
  const [shares, calendars, viewer] = await Promise.all([
    sharesOf([row.id]),
    calendarsById([row.calendarId]),
    viewerOf(principal),
  ]);
  const list = shares.get(row.id) ?? [];
  const placement = placementOf(
    viewer,
    row,
    list.find((share) => share.userId === principal.userId),
  );
  if (!placement) throw new DomainError("NOT_FOUND", "Event not found");
  return toEvent(row, list, calendars.get(row.calendarId), placement);
}

function checkTimes(startAt: number, endAt: number): void {
  if (endAt <= startAt)
    throw new DomainError("BAD_REQUEST", "An event must end after it starts");
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
  placed: Map<string, string | null> = new Map(),
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
        calendarId: placed.get(userId) ?? null,
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

function toEvent(
  row: EventRow,
  shares: ShareRow[],
  cal: CalendarRow | undefined,
  placement: Placement,
): CalendarEvent {
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
    calendarId: row.calendarId,
    shownIn: placement.shownIn,
    access: placement.access,
    source: cal?.source ?? "matron",
    repeatsAtSource: row.externalSeriesId !== null,
    externalUrl: row.externalUrl,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function toOccurrence(
  row: EventRow,
  cal: CalendarRow | undefined,
  placement: Placement,
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
    calendarId: placement.shownIn,
    color: placement.color,
    source: cal?.source ?? "matron",
  };
}
