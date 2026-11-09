import { env } from "cloudflare:workers";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getGoogleOAuthApp } from "@backend/arch-settings/service";
import { base64url, fromBase64url, hmacSign, hmacVerify } from "@backend/commons/crypto";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import { decryptSecret, encryptSecret } from "@backend/commons/secrets";
import { MAIN_BRANCH, type Principal } from "@backend/commons/principal";
import {
  calendarEvent,
  calendarEventException,
  calendarEventAttachment,
  calendarEventHidden,
  calendarEventLabel,
  calendarEventShare,
  googleCalendarConnection,
} from "@backend/db-models/calendar";
import { getDb } from "@backend/db-models/db";
import {
  CALENDAR_COLORS,
  type EventResponse,
  type GoogleCalendar,
  type GoogleStatus,
} from "@shared/contract/app/calendar";
import {
  deleteCalendars,
  ensureImportedCalendar,
  importedCalendarsOf,
  type CalendarRow,
} from "./calendars";
import {
  authorizationUrl,
  exchangeCode,
  fetchAccountEmail,
  CALENDAR_READ_SCOPE,
  GoogleGrantError,
  GoogleUnauthorizedError,
  listCalendars as listGoogleCalendarsAt,
  listEvents,
  listInstances,
  refreshAccessToken,
  revokeToken,
  type GoogleEvent,
  type GoogleOAuthApp,
} from "./google-api";
import {
  importedAttachmentsOf,
  importedAttachmentWrites,
  importedLinks,
  type ImportedAttachment,
} from "./attachments";
import { calendarPermissions } from "./permissions";
import { canonicalRule, expandSeries, fromWallClock } from "./recurrence";

const log = logger("calendar/google");

type ConnectionRow = typeof googleCalendarConnection.$inferSelect;

/** The purpose the stored tokens are sealed for, under SECRETS_KEY. */
const TOKEN_PURPOSE = "google-calendar-token";
const STATE_PURPOSE = "google-oauth-state";
const STATE_TTL_MS = 10 * 60_000;
/** What a sync mirrors: a month back and a year ahead. Older imported events stay as they were. */
const SYNC_PAST_MS = 31 * 24 * 60 * 60_000;
const SYNC_AHEAD_MS = 366 * 24 * 60 * 60_000;
/** D1 binds at most 100 parameters a statement, so ids go in chunks. */
const ID_CHUNK = 90;
const WRITE_CHUNK = 50;
const DEFAULT_RETURN = "/settings";

function signingKey(): string {
  return (env as unknown as { SIGNING_KEY: string }).SIGNING_KEY;
}

/** The caller's Google Calendar link, and whether one can be made here. */
export async function getGoogleStatus(
  principal: Principal,
  branch: string,
): Promise<GoogleStatus> {
  calendarPermissions.require(principal, "view");
  const [app, row] = await Promise.all([
    getGoogleOAuthApp(),
    connectionOf(principal.userId),
  ]);
  return {
    configured: app !== null,
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

/** The Google consent URL to send the caller to, with a signed state naming them. */
export async function startGoogleConnect(
  principal: Principal,
  branch: string,
  returnTo: string | undefined,
): Promise<{ url: string }> {
  calendarPermissions.require(principal, "connect");
  if (branch !== MAIN_BRANCH) {
    // Google returns to production, whose database a branch only copies.
    throw new DomainError("CONFLICT", "Connect Google Calendar on main, not on a branch");
  }
  const app = await requireApp();
  const state = await signState({
    u: principal.userId,
    e: Date.now() + STATE_TTL_MS,
    r: safeReturn(returnTo),
    n: base64url(crypto.getRandomValues(new Uint8Array(12))),
  });
  log.info("google connect started", { userId: principal.userId });
  return { url: authorizationUrl(app, state) };
}

/**
 * Finishes the consent: Google sent the browser back with a code. Stores the
 * grant, imports the primary calendar the first time, syncs, and answers where
 * to send the browser next.
 */
export async function finishGoogleConnect(
  principal: Principal,
  callbackUrl: URL,
): Promise<string> {
  calendarPermissions.require(principal, "connect");
  const state = await verifyState(callbackUrl.searchParams.get("state"));
  const back = (result: string) =>
    withParam(state?.r ?? DEFAULT_RETURN, "google", result);
  if (!state || state.u !== principal.userId) {
    log.warn("google callback with a bad state", { userId: principal.userId });
    return back("invalid");
  }
  if (callbackUrl.searchParams.get("error")) return back("denied");
  const code = callbackUrl.searchParams.get("code");
  if (!code) return back("invalid");
  const app = await requireApp();
  let tokens;
  try {
    tokens = await exchangeCode(app, code);
  } catch (err) {
    log.warn("google code exchange failed", { err, userId: principal.userId });
    return back("failed");
  }
  if (!tokens.grantedScopes.includes(CALENDAR_READ_SCOPE))
    return back("no-calendar-access");
  const existing = await connectionOf(principal.userId);
  const refreshToken =
    tokens.refreshToken ??
    (existing ? await decryptSecret(TOKEN_PURPOSE, existing.refreshToken) : null);
  if (!refreshToken) return back("failed");
  const googleEmail = await fetchAccountEmail(tokens.accessToken);
  if (existing && existing.googleEmail !== googleEmail) {
    // Another account: what the old one imported goes with it.
    await deleteCalendars(
      (await importedCalendarsOf(principal.userId, "google")).map((c) => c.id),
    );
  }
  const sealed = {
    googleEmail,
    refreshToken: await encryptSecret(TOKEN_PURPOSE, refreshToken),
    accessToken: await encryptSecret(TOKEN_PURPOSE, tokens.accessToken),
    accessTokenExpiresAt: new Date(tokens.expiresAt),
    status: "active" as const,
    lastError: null,
    updatedAt: new Date(),
  };
  await getDb()
    .insert(googleCalendarConnection)
    .values({
      id: newEntityId("GOOGLE_CALENDAR_CONNECTION"),
      userId: principal.userId,
      ...sealed,
    })
    .onConflictDoUpdate({ target: googleCalendarConnection.userId, set: sealed });
  log.info("google calendar connected", { userId: principal.userId });

  if ((await importedCalendarsOf(principal.userId, "google")).length === 0) {
    try {
      const primary = (await listGoogleCalendarsAt(tokens.accessToken)).find(
        (c) => c.primary,
      );
      if (primary) {
        await ensureImportedCalendar(
          principal.userId,
          "google",
          primary.id,
          primary.summary,
          googleColor(primary.backgroundColor),
        );
      }
    } catch (err) {
      log.warn("google calendar list failed", { err, userId: principal.userId });
    }
  }
  const row = await connectionOf(principal.userId);
  if (row) await syncConnection(row, app);
  return back("connected");
}

/** The caller's calendars at Google, marked with which are imported. */
export async function listGoogleCalendars(
  principal: Principal,
): Promise<GoogleCalendar[]> {
  calendarPermissions.require(principal, "view");
  const row = await requireConnection(principal.userId);
  const app = await requireApp();
  const [entries, imported] = await Promise.all([
    withAccess(row, app, (token) => listGoogleCalendarsAt(token)),
    importedCalendarsOf(principal.userId, "google"),
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
  const app = await requireApp();
  const entries = await withAccess(row, app, (token) => listGoogleCalendarsAt(token));
  const wanted = new Set(calendarIds);
  const imported = await importedCalendarsOf(principal.userId, "google");
  await deleteCalendars(
    imported.filter((c) => !wanted.has(c.externalId ?? "")).map((c) => c.id),
  );
  for (const entry of entries) {
    if (!wanted.has(entry.id)) continue;
    await ensureImportedCalendar(
      principal.userId,
      "google",
      entry.id,
      entry.summary,
      googleColor(entry.backgroundColor),
    );
  }
  log.info("google calendars selected", {
    userId: principal.userId,
    count: entries.filter((e) => wanted.has(e.id)).length,
  });
  await syncConnection((await connectionOf(principal.userId))!, app);
  return getGoogleStatus(principal, branch);
}

export async function syncGoogleCalendar(
  principal: Principal,
  branch: string,
): Promise<GoogleStatus> {
  calendarPermissions.require(principal, "view");
  const row = await requireConnection(principal.userId);
  await syncConnection(row, await requireApp());
  return getGoogleStatus(principal, branch);
}

/** Forgets the link, and the calendars and events it brought in. */
export async function disconnectGoogle(
  principal: Principal,
  branch: string,
): Promise<GoogleStatus> {
  calendarPermissions.require(principal, "connect");
  const row = await connectionOf(principal.userId);
  await deleteCalendars(
    (await importedCalendarsOf(principal.userId, "google")).map((c) => c.id),
  );
  if (row) {
    await getDb()
      .delete(googleCalendarConnection)
      .where(eq(googleCalendarConnection.id, row.id));
    // Only main revokes: a branch's copy of the grant is production's too.
    if (branch === MAIN_BRANCH) {
      const token = await decryptSecret(TOKEN_PURPOSE, row.refreshToken).catch(
        () => null,
      );
      if (token) await revokeToken(token);
    }
  }
  log.info("google calendar disconnected", { userId: principal.userId });
  return getGoogleStatus(principal, branch);
}

/** Syncs every member's active link; the scheduled run. Never throws for one member's failure. */
export async function syncAllGoogleConnections(): Promise<void> {
  const app = await getGoogleOAuthApp();
  if (!app) return;
  const rows = await getDb()
    .select()
    .from(googleCalendarConnection)
    .where(eq(googleCalendarConnection.status, "active"));
  for (const row of rows) await syncConnection(row, app);
  log.info("google calendars synced", { connections: rows.length });
}

/** Mirrors the window of every imported calendar of the link's owner; records the outcome on the link. */
async function syncConnection(row: ConnectionRow, app: GoogleOAuthApp): Promise<void> {
  const calendars = await importedCalendarsOf(row.userId, "google");
  const now = Date.now();
  const from = now - SYNC_PAST_MS;
  const to = now + SYNC_AHEAD_MS;
  const failures: string[] = [];
  let status: ConnectionRow["status"] = "active";
  for (const cal of calendars) {
    try {
      const { timeZone, events } = await withAccess(row, app, (token) =>
        listEvents(token, cal.externalId!, from, to),
      );
      await mirrorCalendar(cal, timeZone, events, from, to, (eventId) =>
        withAccess(row, app, (token) =>
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
  await getDb()
    .update(googleCalendarConnection)
    .set({
      status,
      lastError: failures.length ? failures.join("; ").slice(0, 1000) : null,
      ...(failures.length === 0 && { lastSyncedAt: new Date() }),
      updatedAt: new Date(),
    })
    .where(eq(googleCalendarConnection.id, row.id));
}

type EventValues = NonNullable<ReturnType<typeof eventValues>>;

interface ImportedRow {
  externalId: string;
  values: EventValues & { rrule: string | null; externalSeriesId: string | null };
  /** The event's attachments at Google (Drive files and the like), as links. */
  attachments: ImportedAttachment[];
}

interface ImportedException {
  originalStartAt: number;
  cancelled: boolean;
  title: string | null;
  description: string | null;
  location: string | null;
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
        attachments: attachmentsOf(event),
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
        attachments: attachmentsOf(event),
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

  // Each imported event's attachments are what Google sent this time; those added
  // here stay. Only events whose attachments changed are written.
  const synced = present.flatMap((event) => {
    const imported = event.externalId ? rows.get(event.externalId) : undefined;
    return imported ? [{ id: event.id, attachments: imported.attachments }] : [];
  });
  const before = await importedAttachmentsOf(synced.map((event) => event.id));
  const attachmentWrites = synced
    .filter(
      (event) =>
        JSON.stringify(event.attachments) !== JSON.stringify(before.get(event.id) ?? []),
    )
    .flatMap((event) => importedAttachmentWrites(event.id, event.attachments));
  for (const chunk of chunks(attachmentWrites as BatchItem<"sqlite">[], WRITE_CHUNK))
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
      db.delete(calendarEventLabel).where(inArray(calendarEventLabel.eventId, ids)),
      db
        .delete(calendarEventAttachment)
        .where(inArray(calendarEventAttachment.eventId, ids)),
      db.delete(calendarEventHidden).where(inArray(calendarEventHidden.eventId, ids)),
      db
        .delete(calendarEventException)
        .where(inArray(calendarEventException.eventId, ids)),
      db.delete(calendarEvent).where(inArray(calendarEvent.id, ids)),
    ]);
  }
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
    location: null,
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
      location: values.location,
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
  return {
    title: (event.summary?.trim() || "(No title)").slice(0, 200),
    description: (event.description?.trim() ?? "").slice(0, 5000),
    location: (event.location?.trim() ?? "").slice(0, 500),
    externalGuests: guestsOf(event),
    allDay,
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    timeZone,
    externalUrl: event.htmlLink?.startsWith("https://") ? event.htmlLink : null,
  };
}

const GOOGLE_RESPONSES: Record<string, EventResponse> = {
  needsAction: "needs_action",
  accepted: "accepted",
  tentative: "tentative",
  declined: "declined",
};

/** A Google event's guests (rooms left out) and their answers, as stored; null when it has none. */
function guestsOf(event: GoogleEvent): string | null {
  const guests = (event.attendees ?? [])
    .filter((guest) => guest.email && !guest.resource)
    .slice(0, 200)
    .map((guest) => ({
      email: guest.email!.slice(0, 320),
      name: guest.displayName?.slice(0, 200) ?? null,
      response: GOOGLE_RESPONSES[guest.responseStatus ?? ""] ?? "needs_action",
      organizer: guest.organizer === true,
      self: guest.self === true,
    }));
  return guests.length ? JSON.stringify(guests) : null;
}

/** A Google event's attachments (Drive files and the like) as links to open at Google. */
function attachmentsOf(event: GoogleEvent): ImportedAttachment[] {
  return importedLinks(
    (event.attachments ?? []).flatMap((item) =>
      item.fileUrl
        ? [
            {
              url: item.fileUrl,
              title: item.title ?? "",
              mimeType: item.mimeType ?? null,
            },
          ]
        : [],
    ),
  );
}

function midnight(day: string, timeZone: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return fromWallClock(
    { year: year!, month: month!, day: date!, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

/**
 * Runs `call` with a live access token, refreshing a stale one first, and once
 * more when Google refuses it. A refreshed token is stored for the next call.
 */
async function withAccess<T>(
  row: ConnectionRow,
  app: GoogleOAuthApp,
  call: (token: string) => Promise<T>,
): Promise<T> {
  let token =
    row.accessToken && (row.accessTokenExpiresAt?.getTime() ?? 0) > Date.now()
      ? await decryptSecret(TOKEN_PURPOSE, row.accessToken).catch(() => null)
      : null;
  let refreshed = false;
  if (!token) {
    token = await refresh(row, app);
    refreshed = true;
  }
  try {
    return await call(token);
  } catch (err) {
    if (!(err instanceof GoogleUnauthorizedError) || refreshed) throw err;
    return call(await refresh(row, app));
  }
}

async function refresh(row: ConnectionRow, app: GoogleOAuthApp): Promise<string> {
  let refreshToken: string;
  try {
    refreshToken = await decryptSecret(TOKEN_PURPOSE, row.refreshToken);
  } catch {
    throw new GoogleGrantError("The stored connection cannot be read; connect again");
  }
  const tokens = await refreshAccessToken(app, refreshToken);
  const accessToken = await encryptSecret(TOKEN_PURPOSE, tokens.accessToken);
  const expiresAt = new Date(tokens.expiresAt);
  await getDb()
    .update(googleCalendarConnection)
    .set({ accessToken, accessTokenExpiresAt: expiresAt, updatedAt: new Date() })
    .where(eq(googleCalendarConnection.id, row.id));
  row.accessToken = accessToken;
  row.accessTokenExpiresAt = expiresAt;
  return tokens.accessToken;
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

async function requireApp(): Promise<GoogleOAuthApp> {
  const app = await getGoogleOAuthApp();
  if (!app) {
    throw new DomainError(
      "UNAVAILABLE",
      "Google Calendar is not set up yet; an owner or admin adds it in App settings",
    );
  }
  return app;
}

interface State {
  /** The user who started. */
  u: string;
  /** Expires at, ms. */
  e: number;
  /** The page to return to. */
  r: string;
  n: string;
}

async function signState(state: State): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(state)));
  return `${payload}.${await hmacSign(signingKey(), `${STATE_PURPOSE}:${payload}`)}`;
}

async function verifyState(value: string | null): Promise<State | null> {
  const [payload, signature] = (value ?? "").split(".");
  if (!payload || !signature) return null;
  if (!(await hmacVerify(signingKey(), `${STATE_PURPOSE}:${payload}`, signature)))
    return null;
  try {
    const state = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as State;
    return state.e > Date.now() ? { ...state, r: safeReturn(state.r) } : null;
  } catch {
    return null;
  }
}

/** A same-origin path to return to; anything else falls back to the settings page. */
function safeReturn(path: string | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return DEFAULT_RETURN;
  }
  return path.slice(0, 500);
}

function withParam(path: string, key: string, value: string): string {
  const url = new URL(path, "https://matron.invalid");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
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
