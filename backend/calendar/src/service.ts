import { and, eq, gte, inArray, isNotNull, lt, or } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import {
  calendar,
  calendarEvent,
  calendarEventException,
  calendarEventHidden,
  calendarEventLabel,
  calendarEventShare,
} from "@backend/db-models/calendar";
import { getDb } from "@backend/db-models/db";
import { knownUserIds } from "@backend/household/users";
import {
  CALENDAR_COLORS,
  type CalendarEvent,
  type CalendarEventCreate,
  type CalendarEventUpdate,
  type Occurrence,
  type OccurrenceException,
  type OccurrenceUpdate,
} from "@shared/contract/app/calendar";
import {
  calendarsById,
  sharedTargetOf,
  viewedCalendarsOf,
  writableCalendarOf,
  type CalendarRow,
  type ViewedCalendar,
} from "./calendars";
import {
  canonicalRule,
  dayBefore,
  expandSeries,
  InvalidRuleError,
  isOccurrence,
  ruleEndingOn,
  type ExceptionInput,
} from "./recurrence";
import { labelsOfEvents, setEventLabels } from "./labels";
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
          and(lt(calendarEvent.startAt, new Date(to)), isNotNull(calendarEvent.rrule)),
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
  const [exceptions, labels, hidden] = await Promise.all([
    exceptionsOf(rows.filter((r) => r.rrule).map((r) => r.id)),
    labelsOfEvents(rows.map((r) => r.id)),
    hiddenBy(principal.userId),
  ]);
  const out: Occurrence[] = [];
  for (const row of rows) {
    const cal = calendars.get(row.calendarId);
    const placement = placementOf(viewer, row, shareOf.get(row.id));
    if (!placement) continue;
    const labelIds = labels.get(row.id) ?? [];
    const isHidden = hidden.has(row.id);
    if (!row.rrule) {
      out.push(
        toOccurrence(row, cal, placement, {
          id: row.id,
          originalStartAt: null,
          title: row.title,
          startAt: row.startAt.getTime(),
          endAt: row.endAt.getTime(),
          recurring: row.externalSeriesId !== null,
          changed: false,
          labelIds,
          hidden: isHidden,
        }),
      );
      continue;
    }
    const own = exceptions.get(row.id) ?? [];
    const titles = new Map(own.map((e) => [e.originalStartAt.getTime(), e.title]));
    for (const window of expandSeries(
      seriesOf(row),
      own.map(toExceptionInput),
      from,
      to,
    )) {
      out.push(
        toOccurrence(row, cal, placement, {
          id: `${row.id}:${window.originalStartAt}`,
          originalStartAt: window.originalStartAt,
          title: titles.get(window.originalStartAt) ?? row.title,
          startAt: window.startAt,
          endAt: window.endAt,
          recurring: true,
          changed: window.changed,
          labelIds,
          hidden: isHidden,
        }),
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

/** Hides the event, every occurrence, from the caller's own calendar; or shows it again. Others are unaffected. */
export async function hideEvent(
  principal: Principal,
  id: string,
  hidden: boolean,
): Promise<CalendarEvent> {
  eventPermissions.require(principal, "view");
  await getEvent(principal, id);
  const db = getDb();
  if (hidden) {
    await db
      .insert(calendarEventHidden)
      .values({
        id: newEntityId("CALENDAR_EVENT_HIDDEN"),
        eventId: id,
        userId: principal.userId,
      })
      .onConflictDoNothing();
  } else {
    await db
      .delete(calendarEventHidden)
      .where(
        and(
          eq(calendarEventHidden.eventId, id),
          eq(calendarEventHidden.userId, principal.userId),
        ),
      );
  }
  log.info(hidden ? "event hidden" : "event unhidden", {
    eventId: id,
    userId: principal.userId,
  });
  return getEvent(principal, id);
}

/** The ids of the events the user hid from their calendar. */
async function hiddenBy(userId: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ eventId: calendarEventHidden.eventId })
    .from(calendarEventHidden)
    .where(eq(calendarEventHidden.userId, userId));
  return new Set(rows.map((row) => row.eventId));
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
      rrule: storedRule(input.rrule ?? null, input.timeZone, input.allDay),
    })
    .returning();
  await writeShares(id, sharedWith, attendees);
  if (input.labelIds?.length) await setEventLabels(id, input.labelIds);
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
    // An imported event is the source's: only who it is shared with and its labels are Matron's own.
    const {
      sharedWith: _shared,
      attendees: _attending,
      labelIds: _labels,
      ...rest
    } = changes;
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
      ...(changes.rrule !== undefined && {
        rrule: storedRule(
          changes.rrule,
          changes.timeZone ?? current.timeZone,
          changes.allDay ?? current.allDay,
        ),
      }),
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
  if (changes.labelIds !== undefined) await setEventLabels(id, changes.labelIds);
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
  if (!current.rrule) throw new DomainError("CONFLICT", "This event does not repeat");
  const until = dayBefore(from);
  const [row] = await getDb()
    .update(calendarEvent)
    .set({
      rrule: ruleEndingOn(current.rrule, until, current.timeZone, current.allDay),
      updatedAt: new Date(),
    })
    .where(eq(calendarEvent.id, id))
    .returning();
  log.info("recurrence stopped", { eventId: id, until, userId: principal.userId });
  return withShares(principal, row!);
}

/** Changes one occurrence of a series: its title, description or times. */
export async function editOccurrence(
  principal: Principal,
  id: string,
  originalStartAt: number,
  changes: OccurrenceUpdate,
): Promise<CalendarEvent> {
  eventPermissions.require(principal, "update");
  const { current, existing } = await occurrenceOf(principal, id, originalStartAt);
  const duration = current.endAt - current.startAt;
  const startAt = changes.startAt ?? existing?.startAt?.getTime() ?? originalStartAt;
  const endAt = changes.endAt ?? existing?.endAt?.getTime() ?? startAt + duration;
  checkTimes(startAt, endAt);
  const values = {
    cancelled: false,
    title: changes.title ?? existing?.title ?? null,
    description: changes.description ?? existing?.description ?? null,
    // Kept only when they differ from the series' own times.
    startAt: startAt === originalStartAt ? null : new Date(startAt),
    endAt: endAt === originalStartAt + duration ? null : new Date(endAt),
    updatedAt: new Date(),
  };
  await writeException(id, originalStartAt, values);
  log.info("occurrence changed", {
    eventId: id,
    originalStartAt,
    userId: principal.userId,
  });
  return getEvent(principal, id);
}

/** Removes one occurrence of a series. */
export async function cancelOccurrence(
  principal: Principal,
  id: string,
  originalStartAt: number,
): Promise<CalendarEvent> {
  eventPermissions.require(principal, "update");
  await occurrenceOf(principal, id, originalStartAt);
  await writeException(id, originalStartAt, {
    cancelled: true,
    title: null,
    description: null,
    startAt: null,
    endAt: null,
    updatedAt: new Date(),
  });
  log.info("occurrence cancelled", {
    eventId: id,
    originalStartAt,
    userId: principal.userId,
  });
  return getEvent(principal, id);
}

/** The series and the occurrence's exception so far, once the caller may change it and it is one. */
async function occurrenceOf(principal: Principal, id: string, originalStartAt: number) {
  const current = await getEvent(principal, id);
  requireEditable(current);
  refuseImported(current);
  if (!current.rrule) throw new DomainError("CONFLICT", "This event does not repeat");
  const series = {
    startAt: current.startAt,
    endAt: current.endAt,
    timeZone: current.timeZone,
    rule: current.rrule,
  };
  if (!isOccurrence(series, originalStartAt)) {
    throw new DomainError("NOT_FOUND", "The event has no occurrence then");
  }
  const existing = await getDb()
    .select()
    .from(calendarEventException)
    .where(
      and(
        eq(calendarEventException.eventId, id),
        eq(calendarEventException.originalStartAt, new Date(originalStartAt)),
      ),
    )
    .get();
  return { current, existing };
}

async function writeException(
  eventId: string,
  originalStartAt: number,
  values: Omit<
    typeof calendarEventException.$inferInsert,
    "id" | "eventId" | "originalStartAt"
  >,
): Promise<void> {
  await getDb()
    .insert(calendarEventException)
    .values({
      id: newEntityId("CALENDAR_EVENT_EXCEPTION"),
      eventId,
      originalStartAt: new Date(originalStartAt),
      ...values,
    })
    .onConflictDoUpdate({
      target: [calendarEventException.eventId, calendarEventException.originalStartAt],
      set: values,
    });
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
  await db.batch([
    db.delete(calendarEventShare).where(eq(calendarEventShare.eventId, id)),
    db.delete(calendarEventException).where(eq(calendarEventException.eventId, id)),
    db.delete(calendarEventLabel).where(eq(calendarEventLabel.eventId, id)),
    db.delete(calendarEventHidden).where(eq(calendarEventHidden.eventId, id)),
    db.delete(calendarEvent).where(eq(calendarEvent.id, id)),
  ]);
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
  const [shares, calendars, viewer, exceptions, labels, hidden] = await Promise.all([
    sharesOf([row.id]),
    calendarsById([row.calendarId]),
    viewerOf(principal),
    row.rrule ? exceptionsOf([row.id]) : new Map<string, ExceptionRow[]>(),
    labelsOfEvents([row.id]),
    getDb()
      .select({ id: calendarEventHidden.id })
      .from(calendarEventHidden)
      .where(
        and(
          eq(calendarEventHidden.eventId, row.id),
          eq(calendarEventHidden.userId, principal.userId),
        ),
      )
      .get(),
  ]);
  const list = shares.get(row.id) ?? [];
  const placement = placementOf(
    viewer,
    row,
    list.find((share) => share.userId === principal.userId),
  );
  if (!placement) throw new DomainError("NOT_FOUND", "Event not found");
  return toEvent(
    row,
    list,
    calendars.get(row.calendarId),
    placement,
    exceptions.get(row.id) ?? [],
    labels.get(row.id) ?? [],
    hidden !== undefined,
  );
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

/** A rule as stored, checked and in the standard's form; a bad one is the caller's mistake. */
function storedRule(
  rule: string | null,
  timeZone: string,
  allDay: boolean,
): string | null {
  if (!rule) return null;
  try {
    return canonicalRule(rule, timeZone, allDay);
  } catch (err) {
    if (err instanceof InvalidRuleError)
      throw new DomainError("BAD_REQUEST", err.message);
    throw err;
  }
}

function seriesOf(row: EventRow) {
  return {
    startAt: row.startAt.getTime(),
    endAt: row.endAt.getTime(),
    timeZone: row.timeZone,
    rule: row.rrule ?? "",
  };
}

type ExceptionRow = typeof calendarEventException.$inferSelect;

/** The exceptions of these series, by event; ids go in chunks under D1's parameter limit. */
async function exceptionsOf(eventIds: string[]): Promise<Map<string, ExceptionRow[]>> {
  const out = new Map<string, ExceptionRow[]>();
  for (let i = 0; i < eventIds.length; i += 90) {
    const rows = await getDb()
      .select()
      .from(calendarEventException)
      .where(inArray(calendarEventException.eventId, eventIds.slice(i, i + 90)));
    for (const row of rows) out.set(row.eventId, [...(out.get(row.eventId) ?? []), row]);
  }
  return out;
}

function toExceptionInput(row: ExceptionRow): ExceptionInput {
  return {
    originalStartAt: row.originalStartAt.getTime(),
    cancelled: row.cancelled,
    startAt: row.startAt?.getTime() ?? null,
    endAt: row.endAt?.getTime() ?? null,
  };
}

function toException(row: ExceptionRow): OccurrenceException {
  return {
    ...toExceptionInput(row),
    title: row.title,
    description: row.description,
  };
}

function toEvent(
  row: EventRow,
  shares: ShareRow[],
  cal: CalendarRow | undefined,
  placement: Placement,
  exceptions: ExceptionRow[],
  labelIds: string[],
  hidden: boolean,
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
    rrule: row.rrule,
    exceptions: exceptions.map(toException),
    sharedWith: shares.map((s) => s.userId).filter((id) => id !== row.creatorId),
    attendees: shares.filter((s) => s.attendee).map((s) => s.userId),
    calendarId: row.calendarId,
    shownIn: placement.shownIn,
    access: placement.access,
    labelIds,
    hidden,
    source: cal?.source ?? "matron",
    repeatsAtSource: row.externalSeriesId !== null,
    externalUrl: row.externalUrl,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

interface OccurrenceFields {
  id: string;
  originalStartAt: number | null;
  title: string;
  startAt: number;
  endAt: number;
  recurring: boolean;
  changed: boolean;
  labelIds: string[];
  hidden: boolean;
}

function toOccurrence(
  row: EventRow,
  cal: CalendarRow | undefined,
  placement: Placement,
  fields: OccurrenceFields,
): Occurrence {
  return {
    ...fields,
    eventId: row.id,
    allDay: row.allDay,
    timeZone: row.timeZone,
    creatorId: row.creatorId,
    calendarId: placement.shownIn,
    color: placement.color,
    source: cal?.source ?? "matron",
  };
}
