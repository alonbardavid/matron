import { logger } from "@backend/commons/logger";

/**
 * The few Google endpoints the calendar import uses, over plain fetch: the
 * OAuth consent URL and token exchange, the account's email, its calendar
 * list and the events in a window. Nothing here touches the database.
 */

const log = logger("calendar/google-api");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export const CALENDAR_READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

/** Read-only calendar access, and the email to show which account is connected. */
export const GOOGLE_SCOPES = ["openid", "email", CALENDAR_READ_SCOPE];

export interface GoogleOAuthApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokens {
  accessToken: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  /** Only on the first grant, or when consent is asked again. */
  refreshToken: string | null;
}

/** Google refused the grant itself (revoked, expired, wrong client): the member connects again. */
export class GoogleGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleGrantError";
  }
}

/** Where to send the browser to ask for access. `prompt=consent` makes Google return a refresh token every time. */
export function authorizationUrl(app: GoogleOAuthApp, state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("redirect_uri", app.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(
  app: GoogleOAuthApp,
  code: string,
): Promise<GoogleTokens & { grantedScopes: string[] }> {
  const body = await tokenRequest({
    client_id: app.clientId,
    client_secret: app.clientSecret,
    redirect_uri: app.redirectUri,
    grant_type: "authorization_code",
    code,
  });
  return {
    ...tokensOf(body),
    grantedScopes: typeof body.scope === "string" ? body.scope.split(" ") : [],
  };
}

export async function refreshAccessToken(
  app: GoogleOAuthApp,
  refreshToken: string,
): Promise<GoogleTokens> {
  const body = await tokenRequest({
    client_id: app.clientId,
    client_secret: app.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return tokensOf(body);
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

async function tokenRequest(
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    log.warn("google token request failed", { status: response.status, error });
    if (
      error === "invalid_grant" ||
      error === "invalid_client" ||
      error === "unauthorized_client"
    ) {
      throw new GoogleGrantError(describeTokenError(error));
    }
    throw new Error(`Google refused the token request (${error})`);
  }
  return body;
}

/** Google refused an access token; refreshing it once may be enough. */
export class GoogleUnauthorizedError extends GoogleGrantError {
  constructor() {
    super("Google no longer accepts this connection; connect again");
    this.name = "GoogleUnauthorizedError";
  }
}

function describeTokenError(error: string): string {
  if (error === "invalid_grant")
    return "Google no longer accepts this connection; connect again";
  return "Google rejected the household's OAuth client; check it in App settings";
}

function tokensOf(body: Record<string, unknown>): GoogleTokens {
  if (typeof body.access_token !== "string")
    throw new Error("Google sent no access token");
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return {
    accessToken: body.access_token,
    // A minute early, so a token never expires mid-sync.
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
  };
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
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
  return (await response.json()) as T;
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
