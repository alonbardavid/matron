import { logger } from "@backend/commons/logger";

/**
 * The few Google endpoints the calendar import reads with a member's access
 * token, over plain fetch: the account's email, its calendar list, the events
 * in a window, and the notice of a calendar's changes. Nothing here touches
 * the database or asks for access.
 */

const log = logger("calendar/google-api");

const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** Google refused the grant itself (revoked, expired, wrong client): the member connects again. */
export class GoogleGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleGrantError";
  }
}

export async function fetchAccountEmail(accessToken: string): Promise<string> {
  const body = await getJson<{ email?: string }>(USERINFO_URL, accessToken);
  return body.email ?? "Google account";
}

export interface GoogleCalendarEntry {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor: string | null;
  timeZone: string | null;
}

/** Every calendar on the account's list, the primary one first. */
export async function listCalendars(accessToken: string): Promise<GoogleCalendarEntry[]> {
  const out: GoogleCalendarEntry[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${CALENDAR_API}/users/me/calendarList`);
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = await getJson<{
      items?: Array<{
        id: string;
        summary?: string;
        summaryOverride?: string;
        primary?: boolean;
        backgroundColor?: string;
        timeZone?: string;
      }>;
      nextPageToken?: string;
    }>(url.toString(), accessToken);
    for (const item of body.items ?? []) {
      out.push({
        id: item.id,
        summary: item.summaryOverride ?? item.summary ?? item.id,
        primary: item.primary ?? false,
        backgroundColor: item.backgroundColor ?? null,
        timeZone: item.timeZone ?? null,
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out.sort((a, b) => Number(b.primary) - Number(a.primary));
}

export interface GoogleEventTime {
  /** `YYYY-MM-DD` for an all-day event. */
  date?: string;
  /** RFC 3339 with an offset. */
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  /** Files attached at Google, such as Drive documents: where to open each. */
  attachments?: { fileUrl?: string; title?: string; mimeType?: string }[];
  /** On a repeating event: its iCalendar lines, `RRULE:...`, `EXDATE...`, `RDATE...`. */
  recurrence?: string[];
  /** Set on an instance of a repeating event: the series' id. */
  recurringEventId?: string;
  /** On an instance: when the series had it due, which names the occurrence it changes or cancels. */
  originalStartTime?: GoogleEventTime;
  htmlLink?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
}

/**
 * The calendar's events overlapping [timeMin, timeMax), repeating ones as
 * their series (`recurrence` set) with the instances changed or cancelled
 * there (`recurringEventId` and `originalStartTime` set; a cancelled one has
 * status `cancelled`). Also returns the calendar's own zone, which all-day
 * events are reckoned in.
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  timeMin: number,
  timeMax: number,
): Promise<{ timeZone: string | null; events: GoogleEvent[] }> {
  return listPaged(
    accessToken,
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
    { singleEvents: "false", showDeleted: "false" },
    timeMin,
    timeMax,
  );
}

/** One series' occurrences in the window, expanded by Google: for a series Matron cannot expand itself. */
export async function listInstances(
  accessToken: string,
  calendarId: string,
  eventId: string,
  timeMin: number,
  timeMax: number,
): Promise<GoogleEvent[]> {
  const { events } = await listPaged(
    accessToken,
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/instances`,
    { showDeleted: "false" },
    timeMin,
    timeMax,
  );
  return events;
}

async function listPaged(
  accessToken: string,
  endpoint: string,
  params: Record<string, string>,
  timeMin: number,
  timeMax: number,
): Promise<{ timeZone: string | null; events: GoogleEvent[] }> {
  const events: GoogleEvent[] = [];
  let timeZone: string | null = null;
  let pageToken: string | undefined;
  do {
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("timeMin", new Date(timeMin).toISOString());
    url.searchParams.set("timeMax", new Date(timeMax).toISOString());
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = await getJson<{
      items?: GoogleEvent[];
      nextPageToken?: string;
      timeZone?: string;
    }>(url.toString(), accessToken);
    timeZone ??= body.timeZone ?? null;
    events.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return { timeZone, events };
}

/** Google refused an access token; a renewed one may be enough. */
export class GoogleUnauthorizedError extends GoogleGrantError {
  constructor() {
    super("Google no longer accepts this connection; connect again");
    this.name = "GoogleUnauthorizedError";
  }
}

/**
 * Asks Google to post to `address` whenever the calendar's events change,
 * until the notice expires. Google names `channelId` in every post.
 */
export async function watchEvents(
  accessToken: string,
  calendarId: string,
  channelId: string,
  address: string,
): Promise<{ resourceId: string; expiresAt: number | null }> {
  const body = await request<{ resourceId: string; expiration?: string }>(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    accessToken,
    { id: channelId, type: "web_hook", address },
  );
  const expiresAt = Number(body.expiration);
  return {
    resourceId: body.resourceId,
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
  };
}

/** Ends a notice `watchEvents` started. */
export async function stopChannel(
  accessToken: string,
  channelId: string,
  resourceId: string,
): Promise<void> {
  await request(`${CALENDAR_API}/channels/stop`, accessToken, {
    id: channelId,
    resourceId,
  });
}

function getJson<T>(url: string, accessToken: string): Promise<T> {
  return request<T>(url, accessToken);
}

/** A GET, or a POST of `body` as JSON; an answer without a body comes back as undefined. */
async function request<T>(url: string, accessToken: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (response.status === 401) throw new GoogleUnauthorizedError();
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    log.warn("google request failed", {
      status: response.status,
      path: new URL(url).pathname,
    });
    throw new Error(
      `Google answered ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Asks Google to forget a grant; best effort, as the member may have revoked it already. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch (err) {
    log.warn("google revoke failed", { err });
  }
}
