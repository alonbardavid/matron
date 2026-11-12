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
import { knownUserIds, listHouseholdUsers } from "@backend/household/users";
import {
  CALENDAR_COLORS,
  EVENT_RESPONSES,
  type Attachment,
  type CalendarEvent,
  type EventResponse,
  type ExternalGuest,
  type SharePermission,
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
import {
  attachFile,
  attachLink,
  attachmentsOfEvents,
  detach,
  dropAttachments,
  type AttachmentUpload,
} from "./attachments";
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

/**
 * What the caller may do with an event: whoever made it, and a household
 * owner, manage it; someone it is shared with does what they were given; one
 * seen through a calendar shared read-only is only seen.
 */
function capabilitiesOf(
  principal: Principal,
  row: EventRow,
  placement: Placement,
  mine: ShareRow | undefined,
): { edit: boolean; manage: boolean } {
  const level: SharePermission =
    placement.access === "read"
      ? "view"
      : row.creatorId === principal.userId || principal.role === "owner"
        ? "manage"
        : (mine?.permission ?? "view");
  return { edit: level !== "view", manage: level === "manage" };
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
    const response = responseOf(row, principal.userId, shareOf.get(row.id));
    // Moved or resized on the calendar by whoever may edit it, when it is Matron's own.
    const editable =
      capabilitiesOf(principal, row, placement, shareOf.get(row.id)).edit &&
      (cal?.source ?? "matron") === "matron";
    if (!row.rrule) {
      out.push(
        toOccurrence(row, cal, placement, {
          id: row.id,
          originalStartAt: null,
          title: row.title,
          location: row.location,
          startAt: row.startAt.getTime(),
          endAt: row.endAt.getTime(),
          recurring: row.externalSeriesId !== null,
          changed: false,
          labelIds,
          hidden: isHidden,
          response,
          editable,
        }),
      );
      continue;
    }
    const own = exceptions.get(row.id) ?? [];
    const changedOf = new Map(own.map((e) => [e.originalStartAt.getTime(), e]));
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
          title: changedOf.get(window.originalStartAt)?.title ?? row.title,
          location: changedOf.get(window.originalStartAt)?.location ?? row.location,
          startAt: window.startAt,
          endAt: window.endAt,
          recurring: true,
          changed: window.changed,
          labelIds,
          hidden: isHidden,
          response,
          editable,
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

/**
 * Uploads a file to the event. Whoever may change the event attaches to it,
 * one imported from Google too: what is attached here is Matron's own.
 */
export async function attachFileToEvent(
  principal: Principal,
  branch: string,
  id: string,
  upload: AttachmentUpload,
): Promise<CalendarEvent> {
  eventPermissions.require(principal, "update");
  requireEditable(await getEvent(principal, id));
  await attachFile(principal, branch, id, upload);
  return getEvent(principal, id);
}

/** Attaches a link to the event, for whoever may change it. */
export async function attachLinkToEvent(
  principal: Principal,
  id: string,
  url: string,
  title: string | undefined,
): Promise<CalendarEvent> {
  eventPermissions.require(principal, "update");
  requireEditable(await getEvent(principal, id));
  await attachLink(principal, id, url, title);
  return getEvent(principal, id);
}

/** Removes something attached here, for whoever may change the event. */
export async function detachFromEvent(
  principal: Principal,
  branch: string,
  id: string,
  attachmentId: string,
): Promise<CalendarEvent> {
  eventPermissions.require(principal, "update");
  requireEditable(await getEvent(principal, id));
  await detach(principal, branch, id, attachmentId);
  return getEvent(principal, id);
}

/**
 * The caller answers an event they made or were given, for every occurrence.
 * Yes and maybe make them an attendee; no keeps them invited, declined.
 */
export async function replyToEvent(
  principal: Principal,
  id: string,
  response: Exclude<EventResponse, "needs_action">,
): Promise<CalendarEvent> {
  eventPermissions.require(principal, "view");
  const current = await getEvent(principal, id);
  const mine = current.creatorId === principal.userId;
  if (!mine && !current.sharedWith.includes(principal.userId)) {
    throw new DomainError(
      "FORBIDDEN",
      "Only whoever made the event, or someone it was shared with, answers it",
    );
  }
  const db = getDb();
  const going = response !== "declined";
  const existing = await db
    .select({ id: calendarEventShare.id })
    .from(calendarEventShare)
    .where(
      and(
        eq(calendarEventShare.eventId, id),
        eq(calendarEventShare.userId, principal.userId),
      ),
    )
    .get();
  if (existing) {
    await db
      .update(calendarEventShare)
      .set({ response, ...(going && { attendee: true }) })
      .where(eq(calendarEventShare.id, existing.id));
  } else {
    // The creator, not listed among those attending, answers all the same.
    await db.insert(calendarEventShare).values({
      id: newEntityId("CALENDAR_EVENT_SHARE"),
      eventId: id,
      userId: principal.userId,
      attendee: going,
      response,
    });
  }
  log.info("event answered", { eventId: id, response, userId: principal.userId });
  return getEvent(principal, id);
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
      location: input.location ?? "",
      creatorId: principal.userId,
      allDay: input.allDay,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      timeZone: input.timeZone,
      calendarId: target.id,
      rrule: storedRule(input.rrule ?? null, input.timeZone, input.allDay),
    })
    .returning();
  await writeShares(
    id,
    principal.userId,
    sharedWith,
    attendees,
    new Map(),
    input.permissions,
  );
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
  const current = await getEvent(principal, id);
  if (current.access !== "edit") {
    throw new DomainError("FORBIDDEN", "This calendar is shared with you read-only");
  }
  // A save sends who it is shared with whether or not that changed: only a real
  // change needs leave to manage the event.
  const sharing =
    differs(changes.sharedWith, current.sharedWith) ||
    differs(changes.attendees, current.attendees) ||
    Object.entries(changes.permissions ?? {}).some(
      ([userId, level]) => (current.permissions[userId] ?? "edit") !== level,
    );
  const {
    sharedWith: _shared,
    attendees: _attending,
    permissions: _levels,
    labelIds,
    ...details
  } = changes;
  const detailed = Object.values(details).some((value) => value !== undefined);
  if (detailed || labelIds !== undefined) requireEditable(current);
  if (sharing) {
    eventPermissions.require(principal, "share");
    requireManage(current, "changes who it is shared with and who attends");
  }
  if (current.source !== "matron" && detailed) {
    // An imported event is the source's: only who it is shared with and its labels are Matron's own.
    throw new DomainError(
      "BAD_REQUEST",
      "This event comes from Google Calendar; change it there",
    );
  }
  let calendarId: string | undefined;
  if (changes.calendarId !== undefined && changes.calendarId !== current.calendarId) {
    if (current.creatorId !== principal.userId) {
      throw new DomainError(
        "FORBIDDEN",
        "Only whoever made the event moves it to another calendar",
      );
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
      ...(changes.location !== undefined && { location: changes.location }),
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
      ...(detailed && { updatedAt: new Date() }),
    })
    .where(eq(calendarEvent.id, id))
    .returning();
  if (sharing) {
    const { sharedWith, attendees } = await resolvePeople(
      current.creatorId,
      changes.sharedWith ?? current.sharedWith,
      changes.attendees ?? current.attendees,
    );
    // Each remaining recipient keeps the calendar they placed it in, their
    // answer and what they may do, unless that is set now.
    const kept = new Map(
      ((await sharesOf([id])).get(id) ?? []).map((share) => [
        share.userId,
        {
          calendarId: share.calendarId,
          response: share.response,
          permission: share.permission,
        },
      ]),
    );
    await db.delete(calendarEventShare).where(eq(calendarEventShare.eventId, id));
    await writeShares(
      id,
      current.creatorId,
      sharedWith,
      attendees,
      kept,
      changes.permissions ?? {},
    );
  }
  if (labelIds !== undefined) await setEventLabels(id, labelIds);
  log.info("event updated", { eventId: id, sharing, userId: principal.userId });
  return withShares(principal, row!);
}

/** Whether a list sent differs from the one held, order aside; not sent is no change. */
function differs(sent: readonly string[] | undefined, held: readonly string[]): boolean {
  if (sent === undefined) return false;
  const a = new Set(sent);
  const b = new Set(held);
  return a.size !== b.size || [...a].some((id) => !b.has(id));
}

/**
 * The caller stops being given an event someone shared with them: it leaves
 * their calendar, and they no longer attend. Whoever made it can share it again.
 */
export async function leaveEvent(principal: Principal, id: string): Promise<void> {
  eventPermissions.require(principal, "view");
  const current = await getEvent(principal, id);
  if (
    current.creatorId === principal.userId ||
    !current.sharedWith.includes(principal.userId)
  ) {
    throw new DomainError(
      "BAD_REQUEST",
      "Only an event someone shared with you can be left",
    );
  }
  const db = getDb();
  await db.batch([
    db
      .delete(calendarEventShare)
      .where(
        and(
          eq(calendarEventShare.eventId, id),
          eq(calendarEventShare.userId, principal.userId),
        ),
      ),
    db
      .delete(calendarEventHidden)
      .where(
        and(
          eq(calendarEventHidden.eventId, id),
          eq(calendarEventHidden.userId, principal.userId),
        ),
      ),
  ]);
  log.info("shared event left", { eventId: id, userId: principal.userId });
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

/** Changes one occurrence of a series: its title, description, location or times. */
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
    location: changes.location ?? existing?.location ?? null,
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
    location: null,
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

/** Removes the event; the files uploaded to it go too when the branch is known. */
export async function removeEvent(
  principal: Principal,
  id: string,
  branch: string | null = null,
): Promise<void> {
  eventPermissions.require(principal, "remove");
  const current = await getEvent(principal, id);
  requireEditable(current);
  refuseImported(current);
  requireManage(current, "removes it");
  const db = getDb();
  await db.batch([
    db.delete(calendarEventShare).where(eq(calendarEventShare.eventId, id)),
    db.delete(calendarEventException).where(eq(calendarEventException.eventId, id)),
    db.delete(calendarEventLabel).where(eq(calendarEventLabel.eventId, id)),
    db.delete(calendarEventHidden).where(eq(calendarEventHidden.eventId, id)),
  ]);
  await dropAttachments([id], branch);
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

/** The caller may change the event's details, occurrences, labels and attachments. */
function requireEditable(item: CalendarEvent): void {
  if (item.access !== "edit") {
    throw new DomainError("FORBIDDEN", "This calendar is shared with you read-only");
  }
  if (!item.can.edit) {
    throw new DomainError(
      "FORBIDDEN",
      "This event was shared with you to view; ask whoever made it to let you edit it",
    );
  }
}

/** The caller may change who the event is shared with and who attends, and remove it. */
function requireManage(item: CalendarEvent, what: string): void {
  if (!item.can.manage) {
    throw new DomainError(
      "FORBIDDEN",
      `Only whoever made the event, or someone allowed to manage it, ${what}`,
    );
  }
}

/** The event as the caller sees it; NOT_FOUND when they may not see it. */
async function withShares(principal: Principal, row: EventRow): Promise<CalendarEvent> {
  const [shares, calendars, viewer, exceptions, labels, hidden, attachments] =
    await Promise.all([
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
      attachmentsOfEvents([row.id]),
    ]);
  const list = shares.get(row.id) ?? [];
  const mine = list.find((share) => share.userId === principal.userId);
  const placement = placementOf(viewer, row, mine);
  if (!placement) throw new DomainError("NOT_FOUND", "Event not found");
  return toEvent(row, list, calendars.get(row.calendarId), placement, {
    exceptions: exceptions.get(row.id) ?? [],
    labelIds: labels.get(row.id) ?? [],
    hidden: hidden !== undefined,
    attachments: attachments.get(row.id) ?? [],
    externalGuests: await externalGuestsOf(principal, row),
    can: capabilitiesOf(principal, row, placement, mine),
  });
}

/** An imported event's guests, each matched by email to a household member where one is. */
async function externalGuestsOf(
  principal: Principal,
  row: EventRow,
): Promise<ExternalGuest[]> {
  const guests = parseGuests(row.externalGuests);
  if (guests.length === 0) return [];
  const members = await listHouseholdUsers(principal);
  const byEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.id]));
  return guests.map(({ self: _self, ...guest }) => ({
    ...guest,
    userId: byEmail.get(guest.email.toLowerCase()) ?? null,
  }));
}

function checkTimes(startAt: number, endAt: number): void {
  if (endAt <= startAt)
    throw new DomainError("BAD_REQUEST", "An event must end after it starts");
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

/** What a recipient keeps when the people on an event change: where they placed it, and their answer. */
interface KeptShare {
  calendarId: string | null;
  response: EventResponse;
  permission: SharePermission;
}

async function writeShares(
  eventId: string,
  creatorId: string,
  sharedWith: string[],
  attendees: string[],
  kept: Map<string, KeptShare> = new Map(),
  levels: Record<string, SharePermission> = {},
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
        calendarId: kept.get(userId)?.calendarId ?? null,
        // What they may do: as set now, else as before, else edit.
        permission: levels[userId] ?? kept.get(userId)?.permission ?? ("edit" as const),
        // Whoever made it is going; everyone else has yet to say.
        response:
          kept.get(userId)?.response ??
          (userId === creatorId ? ("accepted" as const) : ("needs_action" as const)),
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
    location: row.location,
  };
}

function toEvent(
  row: EventRow,
  shares: ShareRow[],
  cal: CalendarRow | undefined,
  placement: Placement,
  extra: {
    exceptions: ExceptionRow[];
    labelIds: string[];
    hidden: boolean;
    attachments: Attachment[];
    externalGuests: ExternalGuest[];
    can: { edit: boolean; manage: boolean };
  },
): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    attachments: extra.attachments,
    creatorId: row.creatorId,
    allDay: row.allDay,
    startAt: row.startAt.getTime(),
    endAt: row.endAt.getTime(),
    timeZone: row.timeZone,
    rrule: row.rrule,
    exceptions: extra.exceptions.map(toException),
    sharedWith: shares.map((s) => s.userId).filter((id) => id !== row.creatorId),
    attendees: shares.filter((s) => s.attendee).map((s) => s.userId),
    replies: Object.fromEntries(
      shares.filter((s) => s.attendee).map((s) => [s.userId, s.response]),
    ),
    externalGuests: extra.externalGuests,
    permissions: Object.fromEntries(
      shares
        .filter((s) => s.userId !== row.creatorId)
        .map((s) => [s.userId, s.permission]),
    ),
    can: extra.can,
    calendarId: row.calendarId,
    shownIn: placement.shownIn,
    access: placement.access,
    labelIds: extra.labelIds,
    hidden: extra.hidden,
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
  location: string;
  startAt: number;
  endAt: number;
  recurring: boolean;
  changed: boolean;
  labelIds: string[];
  hidden: boolean;
  response: EventResponse | null;
  editable: boolean;
}

/**
 * The caller's answer to an event: theirs when they attend. For an event
 * imported to their own calendar, their answer at the source.
 */
function responseOf(
  row: EventRow,
  userId: string,
  share: ShareRow | undefined,
): EventResponse | null {
  if (row.creatorId === userId) {
    const self = parseGuests(row.externalGuests).find((guest) => guest.self);
    return self?.response ?? share?.response ?? "accepted";
  }
  return share?.attendee ? share.response : null;
}

interface StoredGuest {
  email: string;
  name: string | null;
  response: EventResponse;
  organizer: boolean;
  /** Whether this guest is the calendar's owner, who imported the event. */
  self: boolean;
}

/** An imported event's guests as stored; anything malformed is left out. */
function parseGuests(value: string | null): StoredGuest[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item: Partial<StoredGuest>) =>
      typeof item?.email === "string" &&
      (EVENT_RESPONSES as readonly string[]).includes(item.response ?? "")
        ? [
            {
              email: item.email,
              name: typeof item.name === "string" ? item.name : null,
              response: item.response as EventResponse,
              organizer: item.organizer === true,
              self: item.self === true,
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
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
