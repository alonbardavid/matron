import { oc } from "@orpc/contract";
import { z } from "zod";
import { dayString } from "./tasks";

export const RECURRENCE_FREQUENCIES = ["weekly", "monthly"] as const;

/**
 * How an event repeats: weekly on weekdays (0 Sunday to 6 Saturday) or monthly
 * on days of the month, until a day or for a number of occurrences, or open-ended.
 */
export const recurrenceSchema = z.object({
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  days: z.array(z.number().int().min(0).max(31)).min(1).max(31),
  until: dayString.nullable(),
  count: z.number().int().min(1).max(1000).nullable(),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;

/** Where a calendar's events come from: made in Matron, or imported from its owner's Google Calendar. */
export const CALENDAR_SOURCES = ["matron", "google"] as const;
export const calendarSourceSchema = z.enum(CALENDAR_SOURCES);
export type CalendarSource = z.infer<typeof calendarSourceSchema>;

/** A CSS hex colour, `#rrggbb`. */
export const colorString = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "A colour as #rrggbb")
  .transform((value) => value.toLowerCase());

/** Colours offered for a calendar; any #rrggbb is accepted. */
export const CALENDAR_COLORS = [
  "#b9086e",
  "#4a8a5c",
  "#3b6fd1",
  "#d9822b",
  "#8e44ad",
  "#16a085",
  "#c0392b",
  "#7f8c8d",
] as const;

/**
 * A member's calendar. Every event belongs to one: each member has a default
 * Matron calendar, and each Google calendar they import is a calendar of its own.
 */
export const calendarSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  color: z.string(),
  source: calendarSourceSchema,
  /** Where new events go when no calendar is named. */
  isDefault: z.boolean(),
});
export type Calendar = z.infer<typeof calendarSchema>;

const calendarName = z.string().trim().min(1, "Give the calendar a name").max(80);

/** An event as stored: a single one, or the series a recurrence generates. */
export const calendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  creatorId: z.string(),
  allDay: z.boolean(),
  /** Milliseconds since the epoch; an all-day event starts at midnight in `timeZone` and ends at the next. */
  startAt: z.number(),
  endAt: z.number(),
  /** The IANA zone the event's wall-clock times and its recurrence are reckoned in. */
  timeZone: z.string(),
  recurrence: recurrenceSchema.nullable(),
  /** User ids the event is shared with, besides the creator. */
  sharedWith: z.array(z.string()),
  /** User ids attending; by default everyone the event is shared with, and the creator. */
  attendees: z.array(z.string()),
  calendarId: z.string(),
  /** The calendar's source. An imported event is changed there; in Matron only who it is shared with changes. */
  source: calendarSourceSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

/** One thing on the calendar: a single event, or one occurrence of a series. */
export const occurrenceSchema = z.object({
  /** The event id, or `<eventId>:<YYYY-MM-DD>` for an occurrence of a series. */
  id: z.string(),
  eventId: z.string(),
  title: z.string(),
  allDay: z.boolean(),
  startAt: z.number(),
  endAt: z.number(),
  recurring: z.boolean(),
  creatorId: z.string(),
  calendarId: z.string(),
  /** The colour of the event's calendar. */
  color: z.string(),
  source: calendarSourceSchema,
});
export type Occurrence = z.infer<typeof occurrenceSchema>;

const title = z.string().trim().min(1, "Give the event a title").max(200);
const description = z.string().trim().max(5000);
const userIds = z.array(z.string()).max(100);

export const calendarEventCreateSchema = z.object({
  title,
  description: description.optional(),
  allDay: z.boolean(),
  startAt: z.number(),
  endAt: z.number(),
  timeZone: z.string().min(1).max(64),
  /** One of the caller's Matron calendars; their default one when left out. */
  calendarId: z.string().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  sharedWith: userIds.optional(),
  attendees: userIds.optional(),
});
export type CalendarEventCreate = z.infer<typeof calendarEventCreateSchema>;

export const calendarEventUpdateSchema = calendarEventCreateSchema.partial();
export type CalendarEventUpdate = z.infer<typeof calendarEventUpdateSchema>;

/** Where Google sends a member back after they allow access; registered on the OAuth client. */
export const GOOGLE_CALLBACK_PATH = "/api/app/calendar/google/callback";

/** One of the member's calendars at Google, and whether it is imported as one of theirs here. */
export const googleCalendarSchema = z.object({
  id: z.string(),
  name: z.string(),
  primary: z.boolean(),
  color: z.string().nullable(),
  selected: z.boolean(),
});
export type GoogleCalendar = z.infer<typeof googleCalendarSchema>;

/** The caller's own Google Calendar link. */
export const googleConnectionSchema = z.object({
  googleEmail: z.string(),
  /** `needs_reconnect` once Google refused the stored grant: connect again to resume. */
  status: z.enum(["active", "needs_reconnect"]),
  lastSyncedAt: z.number().nullable(),
  lastError: z.string().nullable(),
});
export type GoogleConnection = z.infer<typeof googleConnectionSchema>;

export const googleStatusSchema = z.object({
  /** Whether an owner or admin has set up the household's Google OAuth app. */
  configured: z.boolean(),
  /** Connecting is done on main: Google returns to production, whose database a branch only copies. */
  canConnect: z.boolean(),
  connection: googleConnectionSchema.nullable(),
});
export type GoogleStatus = z.infer<typeof googleStatusSchema>;

/** Importing the caller's Google Calendar, one way: Google to Matron. */
export const googleCalendarContract = {
  status: oc
    .route({ method: "GET", path: "/api/app/calendar/google" })
    .output(googleStatusSchema),
  /** Where to send the browser to allow access; Google returns it to GOOGLE_CALLBACK_PATH. */
  connect: oc
    .route({ method: "POST", path: "/api/app/calendar/google/connect" })
    .input(z.object({ returnTo: z.string().max(500).optional() }))
    .output(z.object({ url: z.string() })),
  /** The caller's Google calendars, read from Google. */
  calendars: oc
    .route({ method: "GET", path: "/api/app/calendar/google/calendars" })
    .output(z.array(googleCalendarSchema)),
  /** Which Google calendars to import, each as a calendar here; imports them right away, and drops the rest with their events. */
  select: oc
    .route({ method: "PUT", path: "/api/app/calendar/google/calendars" })
    .input(z.object({ calendarIds: z.array(z.string().min(1).max(300)).min(1).max(50) }))
    .output(googleStatusSchema),
  sync: oc
    .route({ method: "POST", path: "/api/app/calendar/google/sync" })
    .output(googleStatusSchema),
  /** Removes the link, its calendars and every event they imported. */
  disconnect: oc
    .route({ method: "DELETE", path: "/api/app/calendar/google" })
    .output(googleStatusSchema),
};

/** The caller's own calendars. */
export const calendarsContract = {
  list: oc
    .route({ method: "GET", path: "/api/app/calendar/calendars" })
    .output(z.array(calendarSchema)),
  create: oc
    .route({ method: "POST", path: "/api/app/calendar/calendars" })
    .input(z.object({ name: calendarName, color: colorString }))
    .output(calendarSchema),
  /** Renames or recolours a calendar; an imported one too. */
  update: oc
    .route({ method: "PUT", path: "/api/app/calendar/calendars/{id}" })
    .input(
      z.object({
        id: z.string(),
        name: calendarName.optional(),
        color: colorString.optional(),
        isDefault: z.literal(true).optional(),
      }),
    )
    .output(calendarSchema),
  /** Removes a Matron calendar and its events; the default one stays. */
  remove: oc
    .route({ method: "DELETE", path: "/api/app/calendar/calendars/{id}" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ ok: z.literal(true) })),
};

export const calendarContract = {
  /** What is on the calendar between two instants, series expanded into occurrences. */
  occurrences: oc
    .route({ method: "GET", path: "/api/app/calendar/occurrences" })
    .input(z.object({ from: z.coerce.number(), to: z.coerce.number() }))
    .output(z.array(occurrenceSchema)),
  get: oc
    .route({ method: "GET", path: "/api/app/calendar/events/{id}" })
    .input(z.object({ id: z.string() }))
    .output(calendarEventSchema),
  create: oc
    .route({ method: "POST", path: "/api/app/calendar/events" })
    .input(calendarEventCreateSchema)
    .output(calendarEventSchema),
  update: oc
    .route({ method: "PUT", path: "/api/app/calendar/events/{id}" })
    .input(calendarEventUpdateSchema.extend({ id: z.string() }))
    .output(calendarEventSchema),
  /** Ends a series before `from`: occurrences before that day stay, later ones go. */
  stop: oc
    .route({ method: "POST", path: "/api/app/calendar/events/{id}/stop" })
    .input(z.object({ id: z.string(), from: dayString }))
    .output(calendarEventSchema),
  remove: oc
    .route({ method: "DELETE", path: "/api/app/calendar/events/{id}" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ ok: z.literal(true) })),
  calendars: calendarsContract,
  google: googleCalendarContract,
};
