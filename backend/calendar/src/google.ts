import { env } from "cloudflare:workers";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getGoogleOAuthApp } from "@backend/arch-settings/service";
import {
  base64url,
  decryptText,
  encryptText,
  fromBase64url,
  hmacSign,
  hmacVerify,
} from "@backend/commons/crypto";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import { MAIN_BRANCH, type Principal } from "@backend/commons/principal";
import {
  calendarEvent,
  calendarEventShare,
  googleCalendarConnection,
} from "@backend/db-models/calendar";
import { getDb } from "@backend/db-models/db";
import {
  CALENDAR_COLORS,
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
  refreshAccessToken,
  revokeToken,
  type GoogleEvent,
  type GoogleOAuthApp,
} from "./google-api";
import { calendarPermissions } from "./permissions";
import { fromWallClock } from "./recurrence";

const log = logger("calendar/google");

type ConnectionRow = typeof googleCalendarConnection.$inferSelect;

/** The key derivation label the stored tokens are sealed under. */
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
    (existing
      ? await decryptText(signingKey(), TOKEN_PURPOSE, existing.refreshToken)
      : null);
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
    refreshToken: await encryptText(signingKey(), TOKEN_PURPOSE, refreshToken),
    accessToken: await encryptText(signingKey(), TOKEN_PURPOSE, tokens.accessToken),
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
      const token = await decryptText(
        signingKey(),
        TOKEN_PURPOSE,
        row.refreshToken,
      ).catch(() => null);
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
      await mirrorCalendar(cal, timeZone, events, from, to);
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

/**
 * Writes the calendar's events in [from, to) over what was imported before:
 * new ones added, changed ones updated in place (keeping who they are shared
 * with), and ones gone from Google removed.
 */
async function mirrorCalendar(
  cal: CalendarRow,
  calendarTimeZone: string | null,
  events: GoogleEvent[],
  from: number,
  to: number,
): Promise<void> {
  const db = getDb();
  const seen = new Set<string>();
  const writes: BatchItem<"sqlite">[] = [];
  for (const event of events) {
    const values = eventValues(event, calendarTimeZone);
    if (!values || seen.has(event.id)) continue;
    seen.add(event.id);
    writes.push(
      db
        .insert(calendarEvent)
        .values({
          id: newEntityId("CALENDAR_EVENT"),
          creatorId: cal.ownerId,
          calendarId: cal.id,
          externalId: event.id,
          ...values,
        })
        .onConflictDoUpdate({
          target: [calendarEvent.calendarId, calendarEvent.externalId],
          set: { ...values, updatedAt: new Date() },
        }),
    );
  }
  for (const chunk of chunks(writes, WRITE_CHUNK))
    await db.batch(chunk as [BatchItem<"sqlite">]);

  const present = await db
    .select({ id: calendarEvent.id, externalId: calendarEvent.externalId })
    .from(calendarEvent)
    .where(
      and(
        eq(calendarEvent.calendarId, cal.id),
        lt(calendarEvent.startAt, new Date(to)),
        gt(calendarEvent.endAt, new Date(from)),
      ),
    );
  const gone = present.filter((e) => !seen.has(e.externalId ?? "")).map((e) => e.id);
  for (const ids of chunks(gone, ID_CHUNK)) {
    await db.batch([
      db.delete(calendarEventShare).where(inArray(calendarEventShare.eventId, ids)),
      db.delete(calendarEvent).where(inArray(calendarEvent.id, ids)),
    ]);
  }
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
    recurrenceFrequency: null,
    recurrenceDays: null,
    recurrenceUntil: null,
    recurrenceCount: null,
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
      ? await decryptText(signingKey(), TOKEN_PURPOSE, row.accessToken).catch(() => null)
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
    refreshToken = await decryptText(signingKey(), TOKEN_PURPOSE, row.refreshToken);
  } catch {
    throw new GoogleGrantError("The stored connection cannot be read; connect again");
  }
  const tokens = await refreshAccessToken(app, refreshToken);
  const accessToken = await encryptText(signingKey(), TOKEN_PURPOSE, tokens.accessToken);
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
