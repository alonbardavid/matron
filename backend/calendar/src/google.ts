import { env, waitUntil } from "cloudflare:workers";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  AccountGrantError,
  AccountNotLinkedError,
  accessTokenOf,
  linkedAccountOf,
  providerAvailable,
  unlinkAccountsOf,
} from "@backend/arch-auth/app-interface";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import { fromWallClock } from "@backend/commons/time";
import { MAIN_BRANCH, type Principal } from "@backend/commons/principal";
import {
  calendar,
  calendarEvent,
  calendarEventException,
  calendarEventHidden,
  calendarEventShare,
  googleCalendarConnection,
  googleCalendarWatch,
} from "@backend/db-models/calendar";
import { getDb } from "@backend/db-models/db";
import { dropAlarms, rearmAlarms } from "@backend/notifications/alarms";
import {
  CALENDAR_COLORS,
  GOOGLE_CALENDAR_SCOPE,
  type GoogleCalendar,
  type GoogleStatus,
} from "@shared/contract/app/calendar";
import { GOOGLE_PUSH_PATH } from "@shared/contract/app/public/calendar";
import {
  deleteCalendars,
  ensureImportedCalendar,
  importedCalendarsOf,
  type CalendarRow,
} from "./calendars";
import {
  fetchAccountEmail,
  GoogleGrantError,
  GoogleUnauthorizedError,
  listCalendars as listGoogleCalendarsAt,
  listEvents,
  listInstances,
  revokeToken,
  stopChannel,
  watchEvents,
  type GoogleEvent,
} from "./google-api";
import { calendarPermissions } from "./permissions";
import { canonicalRule, expandSeries } from "./recurrence";

const log = logger("calendar/google");

type ConnectionRow = typeof googleCalendarConnection.$inferSelect;

/**
 * The cron the full sync of every member runs on, as the deployment's config
 * declares it (`GOOGLE_SYNC_CRON` in scripts/lib/wrangler-config.mjs): daily.
 */
export const GOOGLE_SYNC_CRON = "17 3 * * *";

/** The provider members link their account at; the link and its tokens are the auth's. */
const PROVIDER = "google";
/** What a sync mirrors: a month back and a year ahead. Older imported events stay as they were. */
const SYNC_PAST_MS = 31 * 24 * 60 * 60_000;
const SYNC_AHEAD_MS = 366 * 24 * 60 * 60_000;
/** A notice this close to its end is replaced by the next full sync. */
const WATCH_RENEW_BEFORE_MS = 2 * 24 * 60 * 60_000;
/** How long Google keeps a notice when it does not say. */
const WATCH_DEFAULT_MS = 7 * 24 * 60 * 60_000;
/** D1 binds at most 100 parameters a statement, so ids go in chunks. */
const ID_CHUNK = 90;
const WRITE_CHUNK = 50;

/** The caller's Google Calendar import, and whether one can be started here. */
export async function getGoogleStatus(
  principal: Principal,
  branch: string,
): Promise<GoogleStatus> {
  calendarPermissions.require(principal, "view");
  const [configured, row] = await Promise.all([
    providerAvailable(PROVIDER),
    connectionOf(principal.userId),
  ]);
  return {
    configured,
    canConnect: branch === MAIN_BRANCH,
    connection: row
      ? {
          googleEmail: row.googleEmail,
          status: row.status,
          lastSyncedAt: row.lastSyncedAt?.getTime() ?? null,
          lastError: row.lastError,
        }
      : null,
  };
}

/**
 * Takes up the Google account the member linked: records whose it is, imports
 * its primary calendar the first time, and lets a refused import resume. The
 * member links the account through the auth; this is what the import makes of it.
 */
async function adoptLinkedAccount(userId: string): Promise<ConnectionRow> {
  const existing = await connectionOf(userId);
  const linked = await linkedAccountOf(userId, PROVIDER);
  if (!linked) {
    throw new DomainError("NOT_FOUND", "Google Calendar is not connected");
  }
  if (!linked.scopes.includes(GOOGLE_CALENDAR_SCOPE)) {
    throw new DomainError(
      "BAD_REQUEST",
      "Allow access to your calendars on Google's page to import them",
    );
  }
  const googleEmail = await withAccess(userId, fetchAccountEmail);
  if (existing && existing.googleEmail !== googleEmail) {
    // Another account: what the old one imported goes with it. Its notices
    // are not this account's to end; Google lets them run out.
    const old = (await importedCalendarsOf(userId, PROVIDER)).map((c) => c.id);
    await unwatchCalendars(userId, old, false);
    await deleteCalendars(old);
  }
  const values = {
    googleEmail,
    status: "active" as const,
    lastError: null,
    updatedAt: new Date(),
  };
  await getDb()
    .insert(googleCalendarConnection)
    .values({ id: newEntityId("GOOGLE_CALENDAR_CONNECTION"), userId, ...values })
    .onConflictDoUpdate({ target: googleCalendarConnection.userId, set: values });
  log.info("google calendar connected", { userId });

  if ((await importedCalendarsOf(userId, PROVIDER)).length === 0) {
    try {
      const primary = (await withAccess(userId, listGoogleCalendarsAt)).find(
        (c) => c.primary,
      );
      if (primary) {
        await ensureImportedCalendar(
          userId,
          PROVIDER,
          primary.id,
          primary.summary,
          googleColor(primary.backgroundColor),
        );
      }
    } catch (err) {
      log.warn("google calendar list failed", { err, userId });
    }
  }
  return (await connectionOf(userId))!;
}

/** The caller's calendars at Google, marked with which are imported. */
export async function listGoogleCalendars(
  principal: Principal,
): Promise<GoogleCalendar[]> {
  calendarPermissions.require(principal, "view");
  const row = await requireConnection(principal.userId);
  const [entries, imported] = await Promise.all([
    withAccess(row.userId, (token) => listGoogleCalendarsAt(token)),
    importedCalendarsOf(principal.userId, PROVIDER),
  ]);
  const selected = new Set(imported.map((c) => c.externalId));
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.summary,
    primary: entry.primary,
    color: entry.backgroundColor,
    selected: selected.has(entry.id),
  }));
}

/** Imports exactly these Google calendars: new ones are added and synced, the rest removed with their events. */
export async function selectGoogleCalendars(
  principal: Principal,
  branch: string,
  calendarIds: string[],
): Promise<GoogleStatus> {
  calendarPermissions.require(principal, "update");
  const row = await requireConnection(principal.userId);
  const entries = await withAccess(row.userId, (token) => listGoogleCalendarsAt(token));
  const wanted = new Set(calendarIds);
  const imported = await importedCalendarsOf(principal.userId, PROVIDER);
  const dropped = imported
    .filter((c) => !wanted.has(c.externalId ?? ""))
    .map((c) => c.id);
  await unwatchCalendars(principal.userId, dropped, branch === MAIN_BRANCH);
  await deleteCalendars(dropped);
  for (const entry of entries) {
    if (!wanted.has(entry.id)) continue;
    await ensureImportedCalendar(
      principal.userId,
      PROVIDER,
      entry.id,
      entry.summary,
      googleColor(entry.backgroundColor),
    );
  }
  log.info("google calendars selected", {
    userId: principal.userId,
    count: entries.filter((e) => wanted.has(e.id)).length,
  });
  await syncConnection((await connectionOf(principal.userId))!, {
    watch: branch === MAIN_BRANCH,
  });
  return getGoogleStatus(principal, branch);
}

/**
 * Brings the caller's imported calendars up to date, and on main has Google
 * tell of their changes from then on. A newly linked account,
 * or one linked again after Google refused the old grant, is taken up first.
 */
export async function syncGoogleCalendar(
  principal: Principal,
  branch: string,
): Promise<GoogleStatus> {
  calendarPermissions.require(principal, "view");
  let row = await connectionOf(principal.userId);
  if (!row || row.status !== "active") {
    calendarPermissions.require(principal, "connect");
    try {
      row = await adoptLinkedAccount(principal.userId);
    } catch (err) {
      // Linked, but Google will not honour it: the member links again.
      if (err instanceof GoogleGrantError) throw new DomainError("CONFLICT", err.message);
      throw err;
    }
  }
  await syncConnection(row, { watch: branch === MAIN_BRANCH });
  return getGoogleStatus(principal, branch);
}

/** Forgets the link, and the calendars and events it brought in. */
export async function disconnectGoogle(
  principal: Principal,
  branch: string,
): Promise<GoogleStatus> {
  calendarPermissions.require(principal, "connect");
  const userId = principal.userId;
  const imported = (await importedCalendarsOf(userId, PROVIDER)).map((c) => c.id);
  await unwatchCalendars(userId, imported, branch === MAIN_BRANCH);
  await deleteCalendars(imported);
  await getDb()
    .delete(googleCalendarConnection)
    .where(eq(googleCalendarConnection.userId, userId));
  // Only main tells Google: a branch's copy of the grant is production's too.
  if (branch === MAIN_BRANCH) {
    const token = await accessTokenOf(userId, PROVIDER).catch(() => null);
    if (token) await revokeToken(token);
  }
  await unlinkAccountsOf(userId, PROVIDER);
  log.info("google calendar disconnected", { userId });
  return getGoogleStatus(principal, branch);
}

/**
 * Syncs every member's active link and renews Google's notices; production's
 * daily run, for whatever a notice missed. Never throws for one member's failure.
 */
export async function syncAllGoogleConnections(): Promise<void> {
  if (!(await providerAvailable(PROVIDER))) return;
  const rows = await getDb()
    .select()
    .from(googleCalendarConnection)
    .where(eq(googleCalendarConnection.status, "active"));
  for (const row of rows) await syncConnection(row, { watch: true });
  log.info("google calendars synced", { connections: rows.length });
}

/**
 * Takes Google's post that a watched calendar changed. Anyone can post here,
 * so the notice must be one the import started: its id, which only Google was
 * given, with the resource Google named for it. The sync it calls for runs
 * after the answer, so Google has it at once.
 */
export async function receiveGooglePush(
  channelId: string,
  resourceId: string,
  state: string | undefined,
): Promise<void> {
  const watch = await getDb()
    .select()
    .from(googleCalendarWatch)
    .where(eq(googleCalendarWatch.id, channelId))
    .get();
  if (!watch || watch.resourceId !== resourceId) {
    throw new DomainError("NOT_FOUND", "No such notice");
  }
  // Google's first post only says the notice began.
  if (state === "sync") return;
  waitUntil(syncWatchedCalendar(watch.calendarId));
}

/** Syncs the one calendar Google said changed. Never throws. */
async function syncWatchedCalendar(calendarId: string): Promise<void> {
  try {
    const cal = await getDb()
      .select()
      .from(calendar)
      .where(eq(calendar.id, calendarId))
      .get();
    if (!cal) return;
    const row = await connectionOf(cal.ownerId);
    if (row?.status !== "active") return;
    await syncConnection(row, { only: cal.id });
    log.info("google calendar synced on notice", { calendarId, userId: cal.ownerId });
  } catch (err) {
    log.warn("google notice sync failed", { err, calendarId });
  }
}

interface SyncOptions {
  /** Whether Google is asked to tell of each calendar's changes: on main only. */
  watch?: boolean;
  /** Only this calendar, the rest left as they are. */
  only?: string;
}

/** Mirrors the window of the imported calendars of the link's owner; records the outcome on the link. */
async function syncConnection(row: ConnectionRow, options: SyncOptions): Promise<void> {
  const imported = await importedCalendarsOf(row.userId, PROVIDER);
  const calendars = options.only
    ? imported.filter((cal) => cal.id === options.only)
    : imported;
  const now = Date.now();
  const from = now - SYNC_PAST_MS;
  const to = now + SYNC_AHEAD_MS;
  const failures: string[] = [];
  let status: ConnectionRow["status"] = "active";
  for (const cal of calendars) {
    try {
      const { timeZone, events } = await withAccess(row.userId, (token) =>
        listEvents(token, cal.externalId!, from, to),
      );
      await mirrorCalendar(cal, timeZone, events, from, to, (eventId) =>
        withAccess(row.userId, (token) =>
          listInstances(token, cal.externalId!, eventId, from, to),
        ),
      );
    } catch (err) {
      if (err instanceof GoogleGrantError) {
        status = "needs_reconnect";
        failures.push(err.message);
        break;
      }
      log.warn("google calendar sync failed", {
        err,
        calendarId: cal.id,
        userId: row.userId,
      });
      failures.push(`${cal.name}: ${err instanceof Error ? err.message : "sync failed"}`);
    }
  }
  // One calendar going well says nothing of the others' last failure.
  const outcome =
    options.only && failures.length === 0
      ? {}
      : {
          status,
          lastError: failures.length ? failures.join("; ").slice(0, 1000) : null,
        };
  await getDb()
    .update(googleCalendarConnection)
    .set({
      ...outcome,
      ...(failures.length === 0 && { lastSyncedAt: new Date() }),
      updatedAt: new Date(),
    })
    .where(eq(googleCalendarConnection.id, row.id));
  if (options.watch && status === "active") await watchCalendars(row.userId, calendars);
}

/** Where Google can post: production's own address, which Google takes over https only. */
function pushAddress(): string | null {
  const origin = (env as unknown as { APP_ORIGIN: string }).APP_ORIGIN.replace(/\/$/, "");
  return origin.startsWith("https://") ? `${origin}${GOOGLE_PUSH_PATH}` : null;
}

/**
 * Has Google tell of each calendar's changes: starts a notice where there is
 * none and replaces one near its end. A calendar Google will not watch (some
 * of its own, like holidays) is left to the daily sync. Never throws.
 */
async function watchCalendars(userId: string, calendars: CalendarRow[]): Promise<void> {
  const address = pushAddress();
  if (!address) return;
  const db = getDb();
  for (const cal of calendars) {
    try {
      const current = await db
        .select()
        .from(googleCalendarWatch)
        .where(eq(googleCalendarWatch.calendarId, cal.id))
        .get();
      if (current && current.expiresAt.getTime() - Date.now() > WATCH_RENEW_BEFORE_MS)
        continue;
      const id = newEntityId("GOOGLE_CALENDAR_WATCH");
      const started = await withAccess(userId, (token) =>
        watchEvents(token, cal.externalId!, id, address),
      );
      const values = {
        id,
        resourceId: started.resourceId,
        expiresAt: new Date(started.expiresAt ?? Date.now() + WATCH_DEFAULT_MS),
        updatedAt: new Date(),
      };
      await db
        .insert(googleCalendarWatch)
        .values({ calendarId: cal.id, ...values })
        .onConflictDoUpdate({ target: googleCalendarWatch.calendarId, set: values });
      if (current) {
        await withAccess(userId, (token) =>
          stopChannel(token, current.id, current.resourceId),
        ).catch((err: unknown) =>
          log.warn("google notice not ended", { err, calendarId: cal.id }),
        );
      }
      log.info("google calendar watched", { calendarId: cal.id, userId });
    } catch (err) {
      log.warn("google calendar not watched", { err, calendarId: cal.id, userId });
    }
  }
}

/**
 * Forgets the notices of these calendars, and with `tellGoogle` ends them
 * there too. A branch's rows are copies of production's, so only main tells
 * Google. Never throws for Google's part.
 */
async function unwatchCalendars(
  userId: string,
  calendarIds: string[],
  tellGoogle: boolean,
): Promise<void> {
  const db = getDb();
  for (const ids of chunks(calendarIds, ID_CHUNK)) {
    const watches = await db
      .select()
      .from(googleCalendarWatch)
      .where(inArray(googleCalendarWatch.calendarId, ids));
    if (tellGoogle) {
      for (const watch of watches) {
        await withAccess(userId, (token) =>
          stopChannel(token, watch.id, watch.resourceId),
        ).catch((err: unknown) =>
          log.warn("google notice not ended", { err, calendarId: watch.calendarId }),
        );
      }
    }
    await db
      .delete(googleCalendarWatch)
      .where(inArray(googleCalendarWatch.calendarId, ids));
  }
}

type EventValues = NonNullable<ReturnType<typeof eventValues>>;

interface ImportedRow {
  externalId: string;
  values: EventValues & { rrule: string | null; externalSeriesId: string | null };
}

interface ImportedException {
  originalStartAt: number;
  cancelled: boolean;
  title: string | null;
  description: string | null;
  startAt: Date | null;
  endAt: Date | null;
  externalId: string | null;
}

/**
 * Writes the calendar's events in [from, to) over what was imported before.
 * A repeating Google event becomes a series here, its RRULE as is, with its
 * changed and cancelled instances (and EXDATEs) as exceptions. A series
 * Matron cannot expand itself (RDATE, EXRULE, a rule it rejects) comes as
 * Google's own instances instead. New events are added, changed ones updated
 * in place (keeping who they are shared with), and ones gone from Google
 * removed: a single event when it overlaps the window, a series when it would
 * occur in it.
 */
async function mirrorCalendar(
  cal: CalendarRow,
  calendarTimeZone: string | null,
  events: GoogleEvent[],
  from: number,
  to: number,
  instancesOf: (eventId: string) => Promise<GoogleEvent[]>,
): Promise<void> {
  const db = getDb();
  const rows = new Map<string, ImportedRow>();
  const exceptions = new Map<string, ImportedException[]>();
  const changedInstances = new Map<string, GoogleEvent[]>();
  for (const event of events) {
    if (event.recurringEventId) {
      const list = changedInstances.get(event.recurringEventId) ?? [];
      list.push(event);
      changedInstances.set(event.recurringEventId, list);
    }
  }
  const addSingle = (event: GoogleEvent, seriesId: string | null) => {
    const values = eventValues(event, calendarTimeZone);
    if (values && !rows.has(event.id)) {
      rows.set(event.id, {
        externalId: event.id,
        values: { ...values, rrule: null, externalSeriesId: seriesId },
      });
    }
  };

  for (const event of events) {
    if (event.recurringEventId) continue;
    if (!event.recurrence?.length) {
      addSingle(event, null);
      continue;
    }
    const values = eventValues(event, calendarTimeZone);
    if (!values) continue;
    const rule = seriesRule(event.recurrence, values.timeZone, values.allDay);
    if (rule) {
      rows.set(event.id, {
        externalId: event.id,
        values: { ...values, rrule: rule.rrule, externalSeriesId: null },
      });
      exceptions.set(event.id, [
        ...rule.exdates.map((at) => cancelledAt(at)),
        ...(changedInstances.get(event.id) ?? []).flatMap((instance) =>
          exceptionOf(instance, values.timeZone, calendarTimeZone),
        ),
      ]);
    } else {
      for (const instance of await instancesOf(event.id)) {
        if (instance.status !== "cancelled") addSingle(instance, event.id);
      }
    }
    changedInstances.delete(event.id);
  }
  // Changed instances of a series Google did not send: shown as they are.
  for (const [seriesId, list] of changedInstances) {
    for (const instance of list) {
      if (instance.status !== "cancelled") addSingle(instance, seriesId);
    }
  }

  const known = new Set(
    (
      await db
        .select({ externalId: calendarEvent.externalId })
        .from(calendarEvent)
        .where(eq(calendarEvent.calendarId, cal.id))
    ).map((event) => event.externalId),
  );
  const writes: BatchItem<"sqlite">[] = [...rows.values()].map(({ externalId, values }) =>
    db
      .insert(calendarEvent)
      .values({
        id: newEntityId("CALENDAR_EVENT"),
        creatorId: cal.ownerId,
        calendarId: cal.id,
        externalId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [calendarEvent.calendarId, calendarEvent.externalId],
        set: { ...values, updatedAt: new Date() },
      }),
  );
  for (const chunk of chunks(writes, WRITE_CHUNK))
    await db.batch(chunk as [BatchItem<"sqlite">]);

  const present = await db
    .select({
      id: calendarEvent.id,
      externalId: calendarEvent.externalId,
      rrule: calendarEvent.rrule,
      startAt: calendarEvent.startAt,
      endAt: calendarEvent.endAt,
      timeZone: calendarEvent.timeZone,
    })
    .from(calendarEvent)
    .where(
      and(eq(calendarEvent.calendarId, cal.id), lt(calendarEvent.startAt, new Date(to))),
    );

  // Whoever imported an event attends it, as an event's creator does by
  // default; only on arrival, so taking themselves off it holds.
  const attending: BatchItem<"sqlite">[] = present
    .filter((event) => rows.has(event.externalId ?? "") && !known.has(event.externalId))
    .map((event) =>
      db
        .insert(calendarEventShare)
        .values({
          id: newEntityId("CALENDAR_EVENT_SHARE"),
          eventId: event.id,
          userId: cal.ownerId,
          attendee: true,
        })
        .onConflictDoNothing(),
    );
  for (const chunk of chunks(attending, WRITE_CHUNK))
    await db.batch(chunk as [BatchItem<"sqlite">]);

  // Each series' exceptions in the window are what Google sent this time.
  for (const event of present) {
    const imported = event.externalId ? exceptions.get(event.externalId) : undefined;
    if (!imported || !event.rrule) continue;
    await mirrorExceptions(event.id, imported, from, to);
  }

  const gone = present
    .filter((event) => !rows.has(event.externalId ?? ""))
    .filter((event) =>
      event.rrule
        ? expandSeries(
            {
              startAt: event.startAt.getTime(),
              endAt: event.endAt.getTime(),
              timeZone: event.timeZone,
              rule: event.rrule,
            },
            [],
            from,
            to,
          ).length > 0
        : event.endAt.getTime() > from,
    )
    .map((event) => event.id);
  for (const ids of chunks(gone, ID_CHUNK)) {
    await db.batch([
      db.delete(calendarEventShare).where(inArray(calendarEventShare.eventId, ids)),
      db.delete(calendarEventHidden).where(inArray(calendarEventHidden.eventId, ids)),
      db
        .delete(calendarEventException)
        .where(inArray(calendarEventException.eventId, ids)),
      db.delete(calendarEvent).where(inArray(calendarEvent.id, ids)),
    ]);
  }
  // What Google sent may have moved an event under someone's alarm.
  const left = new Set(gone);
  await dropAlarms("event", gone);
  await rearmAlarms(
    "event",
    present.map((event) => event.id).filter((id) => !left.has(id)),
  );
}

/** Replaces a series' exceptions due in [from, to) with those Google sent; ones outside stay. */
async function mirrorExceptions(
  eventId: string,
  imported: ImportedException[],
  from: number,
  to: number,
): Promise<void> {
  const db = getDb();
  const keep = new Set(imported.map((e) => e.originalStartAt));
  const existing = await db
    .select({ id: calendarEventException.id, at: calendarEventException.originalStartAt })
    .from(calendarEventException)
    .where(
      and(
        eq(calendarEventException.eventId, eventId),
        gte(calendarEventException.originalStartAt, new Date(from)),
        lt(calendarEventException.originalStartAt, new Date(to)),
      ),
    );
  const stale = existing.filter((e) => !keep.has(e.at.getTime())).map((e) => e.id);
  const writes: BatchItem<"sqlite">[] = imported.map(({ originalStartAt, ...values }) =>
    db
      .insert(calendarEventException)
      .values({
        id: newEntityId("CALENDAR_EVENT_EXCEPTION"),
        eventId,
        originalStartAt: new Date(originalStartAt),
        ...values,
      })
      .onConflictDoUpdate({
        target: [calendarEventException.eventId, calendarEventException.originalStartAt],
        set: { ...values, updatedAt: new Date() },
      }),
  );
  for (const ids of chunks(stale, ID_CHUNK)) {
    writes.push(
      db.delete(calendarEventException).where(inArray(calendarEventException.id, ids)),
    );
  }
  for (const chunk of chunks(writes, WRITE_CHUNK))
    await db.batch(chunk as [BatchItem<"sqlite">]);
}

/**
 * A Google series' iCalendar lines as Matron's: its one RRULE, stored as is,
 * and its EXDATEs as instants. Null when Matron cannot expand it the same way
 * (an RDATE, an EXRULE, several rules, a rule it rejects).
 */
function seriesRule(
  lines: string[],
  timeZone: string,
  allDay: boolean,
): { rrule: string; exdates: number[] } | null {
  const rules = lines.filter((line) => /^RRULE:/i.test(line));
  const other = lines.filter((line) => !/^(RRULE:|EXDATE[;:])/i.test(line));
  if (rules.length !== 1 || other.length > 0) return null;
  let rrule: string;
  try {
    rrule = canonicalRule(rules[0]!, timeZone, allDay);
  } catch {
    return null;
  }
  const exdates = lines
    .filter((line) => /^EXDATE[;:]/i.test(line))
    .flatMap((line) => dateList(line, timeZone));
  return { rrule, exdates };
}

/**
 * The instants an iCalendar date list names: `EXDATE;TZID=Europe/London:20261110T090000,...`,
 * `EXDATE;VALUE=DATE:20261110` (midnight in the zone) or `EXDATE:20261110T090000Z`.
 */
export function dateList(line: string, timeZone: string): number[] {
  const colon = line.indexOf(":");
  const params = line.slice(0, colon);
  const zone = /TZID=([^;:]+)/i.exec(params)?.[1] ?? timeZone;
  return line
    .slice(colon + 1)
    .split(",")
    .map((value) => {
      const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(
        value.trim(),
      );
      if (!m) return NaN;
      const [, y, mo, d, h, mi, se, z] = m;
      if (!h) return midnight(`${y}-${mo}-${d}`, timeZone);
      if (z) return Date.UTC(+y!, +mo! - 1, +d!, +h, +mi!, +se!);
      return fromWallClock(
        { year: +y!, month: +mo!, day: +d!, hour: +h, minute: +mi!, second: +se! },
        zone,
      );
    })
    .filter(Number.isFinite);
}

function cancelledAt(originalStartAt: number): ImportedException {
  return {
    originalStartAt,
    cancelled: true,
    title: null,
    description: null,
    startAt: null,
    endAt: null,
    externalId: null,
  };
}

/** A changed or cancelled Google instance as an exception of its series. */
function exceptionOf(
  instance: GoogleEvent,
  seriesTimeZone: string,
  calendarTimeZone: string | null,
): ImportedException[] {
  const original = instance.originalStartTime;
  const originalStartAt = original?.date
    ? midnight(original.date, original.timeZone ?? seriesTimeZone)
    : original?.dateTime
      ? Date.parse(original.dateTime)
      : NaN;
  if (!Number.isFinite(originalStartAt)) return [];
  if (instance.status === "cancelled") return [cancelledAt(originalStartAt)];
  const values = eventValues(instance, calendarTimeZone);
  if (!values) return [];
  return [
    {
      originalStartAt,
      cancelled: false,
      title: values.title,
      description: values.description,
      startAt: values.startAt,
      endAt: values.endAt,
      externalId: instance.id,
    },
  ];
}

/** A Google event as Matron's columns, or null for one to skip (cancelled, or without times). */
function eventValues(event: GoogleEvent, calendarTimeZone: string | null) {
  if (event.status === "cancelled" || !event.start) return null;
  const timeZone = event.start.timeZone ?? calendarTimeZone ?? "UTC";
  let allDay: boolean;
  let startAt: number;
  let endAt: number;
  if (event.start.date) {
    allDay = true;
    startAt = midnight(event.start.date, timeZone);
    // Google's end day is exclusive; Matron's all-day span ends the last day's final instant.
    const endDay = event.end?.date;
    endAt = (endDay ? midnight(endDay, timeZone) : startAt + 24 * 60 * 60_000) - 1;
  } else if (event.start.dateTime) {
    allDay = false;
    startAt = Date.parse(event.start.dateTime);
    endAt = event.end?.dateTime ? Date.parse(event.end.dateTime) : startAt;
  } else {
    return null;
  }
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return null;
  // Matron's events end after they start; Google allows zero-length ones.
  endAt = Math.max(endAt, startAt + 60_000);
  const location = event.location?.trim();
  const description = [location && `Location: ${location}`, event.description?.trim()]
    .filter(Boolean)
    .join("\n\n");
  return {
    title: (event.summary?.trim() || "(No title)").slice(0, 200),
    description: description.slice(0, 5000),
    allDay,
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    timeZone,
    externalUrl: event.htmlLink?.startsWith("https://") ? event.htmlLink : null,
  };
}

function midnight(day: string, timeZone: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return fromWallClock(
    { year: year!, month: month!, day: date!, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

/**
 * Calls Google with the member's access token, which the auth keeps valid.
 * A token Google refuses all the same is renewed once.
 */
async function withAccess<T>(
  userId: string,
  call: (token: string) => Promise<T>,
): Promise<T> {
  try {
    return await call(await accessToken(userId));
  } catch (err) {
    if (!(err instanceof GoogleUnauthorizedError)) throw err;
    return call(await accessToken(userId, true));
  }
}

/** The member's access token; a link that is gone or no longer honoured is a refused grant. */
async function accessToken(userId: string, renew = false): Promise<string> {
  try {
    return await accessTokenOf(userId, PROVIDER, { renew });
  } catch (err) {
    if (err instanceof AccountNotLinkedError || err instanceof AccountGrantError) {
      throw new GoogleGrantError(
        "Google no longer accepts this connection; connect again",
      );
    }
    throw err;
  }
}

async function connectionOf(userId: string): Promise<ConnectionRow | undefined> {
  return getDb()
    .select()
    .from(googleCalendarConnection)
    .where(eq(googleCalendarConnection.userId, userId))
    .get();
}

async function requireConnection(userId: string): Promise<ConnectionRow> {
  const row = await connectionOf(userId);
  if (!row) throw new DomainError("NOT_FOUND", "Google Calendar is not connected");
  return row;
}

/** Google's colour for the calendar when it is a plain hex, else the first of Matron's. */
function googleColor(color: string | null): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color)
    ? color.toLowerCase()
    : CALENDAR_COLORS[1];
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
