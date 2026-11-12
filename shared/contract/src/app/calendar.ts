import { oc } from "@orpc/contract";
import { z } from "zod";
import { dayString } from "./tasks";

/**
 * How an event repeats: an iCalendar RRULE value (RFC 5545), without the
 * `RRULE:` prefix: `FREQ=WEEKLY;BYDAY=MO,WE`, `FREQ=MONTHLY;BYDAY=-1FR`,
 * `FREQ=YEARLY;INTERVAL=2;COUNT=5`. The event's start is its first occurrence.
 * UNTIL may be given as a day (`UNTIL=20271231`), the last day it occurs on;
 * it is stored as the standard wants it. Daily, weekly, monthly and yearly.
 */
export const rruleString = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(
    /^(RRULE:)?FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;|$)/i,
    "An RRULE such as FREQ=WEEKLY;BYDAY=MO",
  );

/** One occurrence of a series cancelled or changed, keyed by when it was due. */
export const occurrenceExceptionSchema = z.object({
  originalStartAt: z.number(),
  cancelled: z.boolean(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  startAt: z.number().nullable(),
  endAt: z.number().nullable(),
});
export type OccurrenceException = z.infer<typeof occurrenceExceptionSchema>;

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

/** How the caller holds a calendar: their own, or shared with them read-only. */
export const CALENDAR_ACCESS = ["owner", "viewer"] as const;

/**
 * A calendar as the caller sees it. Every event belongs to one: each member
 * has a default Matron calendar, and each Google calendar they import is a
 * calendar of its own. An owner may share a calendar read-only with others.
 */
export const calendarSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  /** The caller's colour for it: the owner's, or a viewer's own choice. */
  color: z.string(),
  source: calendarSourceSchema,
  access: z.enum(CALENDAR_ACCESS),
  /** Where new events go when no calendar is named. Owner only. */
  isDefault: z.boolean(),
  /** Where events others share with the owner show, unless placed elsewhere. Owner only. */
  receivesShared: z.boolean(),
  /** Who the owner shares it with; empty for a viewer. */
  sharedWith: z.array(z.string()),
});
export type Calendar = z.infer<typeof calendarSchema>;

const calendarName = z.string().trim().min(1, "Give the calendar a name").max(80);

/**
 * Something attached to an event: a file uploaded here (its `url` serves it)
 * or a link. Ones imported from Google are links with the source `google`,
 * changed there; those added here are removed by whoever may edit the event.
 */
export const attachmentSchema = z.object({
  id: z.string(),
  kind: z.enum(["file", "link"]),
  title: z.string(),
  url: z.string(),
  mimeType: z.string().nullable(),
  source: calendarSourceSchema,
  createdBy: z.string().nullable(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** What may be uploaded to an event: pictures, PDFs, plain text and office documents. */
export const ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_EVENT = 20;

/** An event as stored: a single one, or the series a recurrence generates. */
export const calendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  /** Where it happens, as written; empty when not given. */
  location: z.string(),
  attachments: z.array(attachmentSchema),
  creatorId: z.string(),
  allDay: z.boolean(),
  /** Milliseconds since the epoch; an all-day event starts at midnight in `timeZone` and ends at the next. */
  startAt: z.number(),
  endAt: z.number(),
  /** The IANA zone the event's wall-clock times and its recurrence are reckoned in. */
  timeZone: z.string(),
  /** How it repeats, or null for a single event. */
  rrule: z.string().nullable(),
  /** Occurrences of the series cancelled or changed. */
  exceptions: z.array(occurrenceExceptionSchema),
  /** User ids the event is shared with, besides the creator. */
  sharedWith: z.array(z.string()),
  /** User ids attending; by default everyone the event is shared with, and the creator. */
  attendees: z.array(z.string()),
  /** The creator's calendar it belongs to. */
  calendarId: z.string(),
  /** The calendar it shows in for the caller: theirs for an event shared with them, or the shared calendar it came through. */
  shownIn: z.string(),
  /** `read` when the caller sees it only through a calendar shared with them. */
  access: z.enum(["edit", "read"]),
  /** Whether the caller hid it from their own calendar. */
  hidden: z.boolean(),
  /** The calendar's source. An imported event is changed there; in Matron only who it is shared with changes. */
  source: calendarSourceSchema,
  /** An imported occurrence of an event that repeats at its source. */
  repeatsAtSource: z.boolean(),
  /** Where to open an imported event at its source. */
  externalUrl: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

/** One thing on the calendar: a single event, or one occurrence of a series. */
export const occurrenceSchema = z.object({
  /** The event id, or `<eventId>:<originalStartAt>` for an occurrence of a series. */
  id: z.string(),
  eventId: z.string(),
  /** For an occurrence of a series: when the series had it due, which names it. */
  originalStartAt: z.number().nullable(),
  /** Whether this occurrence was changed on its own. */
  changed: z.boolean(),
  title: z.string(),
  /** Where this occurrence happens; empty when not given. */
  location: z.string(),
  allDay: z.boolean(),
  startAt: z.number(),
  endAt: z.number(),
  /** The zone the event is reckoned in: an all-day one covers whole days there. */
  timeZone: z.string(),
  recurring: z.boolean(),
  creatorId: z.string(),
  /** The calendar it shows in for the caller (see the event's `shownIn`). */
  calendarId: z.string(),
  /** The caller's colour for that calendar. */
  color: z.string(),
  source: calendarSourceSchema,
  /** Whether the caller hid the event; listed all the same, for the calendar to show or leave out. */
  hidden: z.boolean(),
});
export type Occurrence = z.infer<typeof occurrenceSchema>;

const title = z.string().trim().min(1, "Give the event a title").max(200);
const description = z.string().trim().max(5000);
const location = z.string().trim().max(500);
const userIds = z.array(z.string()).max(100);

export const calendarEventCreateSchema = z.object({
  title,
  description: description.optional(),
  location: location.optional(),
  allDay: z.boolean(),
  startAt: z.number(),
  endAt: z.number(),
  timeZone: z.string().min(1).max(64),
  /** One of the caller's Matron calendars; their default one when left out. */
  calendarId: z.string().optional(),
  rrule: rruleString.nullable().optional(),
  sharedWith: userIds.optional(),
  attendees: userIds.optional(),
});
export type CalendarEventCreate = z.infer<typeof calendarEventCreateSchema>;

export const calendarEventUpdateSchema = calendarEventCreateSchema.partial();
export type CalendarEventUpdate = z.infer<typeof calendarEventUpdateSchema>;

/** What one occurrence of a series changes; left out keeps the series' own. */
export const occurrenceUpdateSchema = z.object({
  title: title.optional(),
  description: description.optional(),
  location: location.optional(),
  startAt: z.number().optional(),
  endAt: z.number().optional(),
});
export type OccurrenceUpdate = z.infer<typeof occurrenceUpdateSchema>;

/** What a member allows when they link their Google account for the import: reading their calendars. */
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

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
  /** The caller's Google calendars, read from Google. */
  calendars: oc
    .route({ method: "GET", path: "/api/app/calendar/google/calendars" })
    .output(z.array(googleCalendarSchema)),
  /** Which Google calendars to import, each as a calendar here; imports them right away, and drops the rest with their events. */
  select: oc
    .route({ method: "PUT", path: "/api/app/calendar/google/calendars" })
    .input(z.object({ calendarIds: z.array(z.string().min(1).max(300)).min(1).max(50) }))
    .output(googleStatusSchema),
  /**
   * Brings the imported calendars up to date. The first time after the member
   * linked their Google account, it also records the link and imports their
   * primary calendar.
   */
  sync: oc
    .route({ method: "POST", path: "/api/app/calendar/google/sync" })
    .output(googleStatusSchema),
  /** Removes the link, its calendars and every event they imported. */
  disconnect: oc
    .route({ method: "DELETE", path: "/api/app/calendar/google" })
    .output(googleStatusSchema),
};

/** The caller's calendars: their own, then those shared with them. */
export const calendarsContract = {
  list: oc
    .route({ method: "GET", path: "/api/app/calendar/calendars" })
    .output(z.array(calendarSchema)),
  create: oc
    .route({ method: "POST", path: "/api/app/calendar/calendars" })
    .input(z.object({ name: calendarName, color: colorString }))
    .output(calendarSchema),
  /**
   * The owner renames, recolours or shares a calendar (an imported one too), or
   * makes a Matron one the default or the one for shared events. A viewer only
   * sets their own colour for it.
   */
  update: oc
    .route({ method: "PUT", path: "/api/app/calendar/calendars/{id}" })
    .input(
      z.object({
        id: z.string(),
        name: calendarName.optional(),
        color: colorString.optional(),
        isDefault: z.literal(true).optional(),
        receivesShared: z.literal(true).optional(),
        sharedWith: z.array(z.string()).max(100).optional(),
      }),
    )
    .output(calendarSchema),
  /** The owner removes a Matron calendar and its events (the default stays); a viewer stops seeing a shared one. */
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
  /** Changes one occurrence of a series; the rest keep the series' own. */
  editOccurrence: oc
    .route({
      method: "PUT",
      path: "/api/app/calendar/events/{id}/occurrences/{originalStartAt}",
    })
    .input(
      occurrenceUpdateSchema.extend({
        id: z.string(),
        originalStartAt: z.coerce.number(),
      }),
    )
    .output(calendarEventSchema),
  /** Removes one occurrence of a series. */
  cancelOccurrence: oc
    .route({
      method: "DELETE",
      path: "/api/app/calendar/events/{id}/occurrences/{originalStartAt}",
    })
    .input(z.object({ id: z.string(), originalStartAt: z.coerce.number() }))
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
  /** Uploads a file to the event (every occurrence). */
  attachFile: oc
    .route({ method: "POST", path: "/api/app/calendar/events/{id}/attachments/files" })
    .input(z.object({ id: z.string(), file: z.file() }))
    .output(calendarEventSchema),
  /** Attaches a link to the event (every occurrence). */
  attachLink: oc
    .route({ method: "POST", path: "/api/app/calendar/events/{id}/attachments/links" })
    .input(
      z.object({
        id: z.string(),
        url: z
          .string()
          .trim()
          .max(2000)
          .url("A web address")
          .refine(
            (value) => /^https?:\/\//i.test(value),
            "A web address (http or https)",
          ),
        title: z.string().trim().max(200).optional(),
      }),
    )
    .output(calendarEventSchema),
  /** Removes something attached here; imported attachments change at their source. */
  detach: oc
    .route({
      method: "DELETE",
      path: "/api/app/calendar/events/{id}/attachments/{attachmentId}",
    })
    .input(z.object({ id: z.string(), attachmentId: z.string() }))
    .output(calendarEventSchema),
  /** Hides the event (every occurrence) from the caller's own calendar, or shows it again. */
  hide: oc
    .route({ method: "PUT", path: "/api/app/calendar/events/{id}/hidden" })
    .input(z.object({ id: z.string(), hidden: z.boolean() }))
    .output(calendarEventSchema),
  /** Shows an event someone shared with the caller in one of the caller's Matron calendars; null for their calendar for shared events. */
  place: oc
    .route({ method: "PUT", path: "/api/app/calendar/events/{id}/placement" })
    .input(z.object({ id: z.string(), calendarId: z.string().nullable() }))
    .output(calendarEventSchema),
  calendars: calendarsContract,
  google: googleCalendarContract,
};
