import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, timestamp, updatedAt } from "./columns";

/** Where a calendar's events come from: made in Matron, or imported from the owner's Google Calendar. */
export const CALENDAR_SOURCES = ["matron", "google"] as const;
export type CalendarSource = (typeof CALENDAR_SOURCES)[number];

/**
 * A member's calendar: every event belongs to one. Each member has a default
 * Matron calendar; each Google calendar they import is a calendar of its own.
 */
export const calendar = sqliteTable(
  "calendar",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    /** A CSS hex colour, `#rrggbb`. */
    color: text("color").notNull(),
    source: text("source", { enum: CALENDAR_SOURCES }).notNull().default("matron"),
    /** For an imported calendar: its id at the source (a Google calendar id). */
    externalId: text("external_id"),
    /** The owner's calendar new events go to; one per owner. */
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    /** Where events others share with the owner show, unless placed elsewhere; one per owner, else the default. */
    receivesShared: integer("receives_shared", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("calendar_owner_idx").on(table.ownerId),
    uniqueIndex("calendar_owner_source_external").on(
      table.ownerId,
      table.source,
      table.externalId,
    ),
  ],
);

/**
 * A calendar shared read-only with another member: they see every event in it,
 * in the colour they choose for it.
 */
export const calendarShare = sqliteTable(
  "calendar_share",
  {
    id: text("id").primaryKey(),
    calendarId: text("calendar_id").notNull(),
    userId: text("user_id").notNull(),
    /** The viewer's own colour for it; the calendar's when null. */
    color: text("color"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("calendar_share_calendar_user").on(table.calendarId, table.userId),
    index("calendar_share_user_idx").on(table.userId),
  ],
);

export const calendarEvent = sqliteTable(
  "calendar_event",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** Where it happens, as written: an address, a room, a link. */
    location: text("location").notNull().default(""),
    creatorId: text("creator_id").notNull(),
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    startAt: timestamp("start_at").notNull(),
    endAt: timestamp("end_at").notNull(),
    timeZone: text("time_zone").notNull(),
    /**
     * For a repeating event: its iCalendar RRULE value (RFC 5545), such as
     * `FREQ=WEEKLY;BYDAY=TU,TH`. The event's start is the series' DTSTART, in
     * `time_zone`; UNTIL is a UTC instant, or a day for an all-day series.
     */
    rrule: text("rrule"),
    /** The calendar it belongs to, always one of the creator's. */
    calendarId: text("calendar_id").notNull(),
    /** For an imported event: its id at the source, unique within its calendar. */
    externalId: text("external_id"),
    /** For an imported occurrence of a repeating event: the series' id at the source. */
    externalSeriesId: text("external_series_id"),
    /** For an imported event: where to open it at the source. */
    externalUrl: text("external_url"),
    /**
     * For an imported event: its guests at the source and their answers, as
     * JSON (`[{ email, name, response, organizer }]`). Read-only here.
     */
    externalGuests: text("external_guests"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("calendar_event_calendar_idx").on(table.calendarId),
    uniqueIndex("calendar_event_calendar_external").on(
      table.calendarId,
      table.externalId,
    ),
  ],
);

/** A guest's answer to an event: as in iCalendar's PARTSTAT, and Google's responseStatus. */
export const EVENT_RESPONSES = [
  "needs_action",
  "accepted",
  "tentative",
  "declined",
] as const;
export type EventResponse = (typeof EVENT_RESPONSES)[number];

export const calendarEventShare = sqliteTable(
  "calendar_event_share",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    userId: text("user_id").notNull(),
    attendee: integer("attendee", { mode: "boolean" }).notNull().default(true),
    /** The member's own answer, which they give; whoever made the event starts as accepted. */
    response: text("response", { enum: EVENT_RESPONSES })
      .notNull()
      .default("needs_action"),
    /** The recipient's own calendar it shows in; their calendar for shared events when null. */
    calendarId: text("calendar_id"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("calendar_event_share_event_user").on(table.eventId, table.userId),
  ],
);

/**
 * One occurrence of a repeating event cancelled or changed, keyed by the
 * instant the series had it due (an iCalendar EXDATE, or a RECURRENCE-ID
 * override).
 */
export const calendarEventException = sqliteTable(
  "calendar_event_exception",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    originalStartAt: timestamp("original_start_at").notNull(),
    cancelled: integer("cancelled", { mode: "boolean" }).notNull().default(false),
    /** What the occurrence changed; null keeps the series' own. */
    title: text("title"),
    description: text("description"),
    location: text("location"),
    startAt: timestamp("start_at"),
    endAt: timestamp("end_at"),
    /** For an imported change: the instance's id at the source. */
    externalId: text("external_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("calendar_event_exception_event_original").on(
      table.eventId,
      table.originalStartAt,
    ),
  ],
);

/**
 * A label the household tags events with, such as "School" or "Medical": a
 * name and a colour, shared by every member. An event shows its labels as
 * coloured bars along its side.
 */
export const calendarLabel = sqliteTable("calendar_label", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** A CSS hex colour, `#rrggbb`. */
  color: text("color").notNull(),
  creatorId: text("creator_id").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A label on an event: on every occurrence of a series. */
export const calendarEventLabel = sqliteTable(
  "calendar_event_label",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    labelId: text("label_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("calendar_event_label_event_label").on(table.eventId, table.labelId),
    index("calendar_event_label_label_idx").on(table.labelId),
  ],
);

/**
 * An event a member hid from their own calendar: every occurrence of it, for
 * them alone. Others still see it; they can show hidden events and unhide it.
 */
export const calendarEventHidden = sqliteTable(
  "calendar_event_hidden",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("calendar_event_hidden_event_user").on(table.eventId, table.userId),
    index("calendar_event_hidden_user_idx").on(table.userId),
  ],
);

export const ATTACHMENT_KINDS = ["file", "link"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/**
 * Something attached to an event, on every occurrence: a file uploaded here,
 * or a link. One imported from Google (a Drive file, say) is a link with the
 * source `google`, replaced on each sync; those added here stay.
 */
export const calendarEventAttachment = sqliteTable(
  "calendar_event_attachment",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    kind: text("kind", { enum: ATTACHMENT_KINDS }).notNull(),
    /** For a file: the uploaded file's id. */
    fileId: text("file_id"),
    /** For a link: where it points, https only. */
    url: text("url"),
    title: text("title").notNull(),
    mimeType: text("mime_type"),
    source: text("source", { enum: CALENDAR_SOURCES }).notNull().default("matron"),
    /** Who added it here; null for an imported one. */
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (table) => [index("calendar_event_attachment_event_idx").on(table.eventId)],
);

export const GOOGLE_CONNECTION_STATUSES = ["active", "needs_reconnect"] as const;
export type GoogleConnectionStatus = (typeof GOOGLE_CONNECTION_STATUSES)[number];

/**
 * A member's import of their own Google Calendar: whose account it is and how
 * the last sync went. The linked account and its tokens are the auth's. Which
 * Google calendars are imported is the member's `google` calendars. One per user.
 */
export const googleCalendarConnection = sqliteTable("google_calendar_connection", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  /** The Google account's email, to show which account is connected. */
  googleEmail: text("google_email").notNull(),
  status: text("status", { enum: GOOGLE_CONNECTION_STATUSES })
    .notNull()
    .default("active"),
  lastSyncedAt: timestamp("last_synced_at"),
  /** Why the last sync failed, cleared by the next one that succeeds. */
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Google's standing notice for one imported calendar: Google posts to the
 * router when the calendar changes, naming this row's id, and that calendar is
 * synced. Google ends a notice after a while, so each is renewed before
 * `expiresAt`. One per imported calendar, on production only.
 */
export const googleCalendarWatch = sqliteTable("google_calendar_watch", {
  /** Also the channel id Google is given; nobody else learns it. */
  id: text("id").primaryKey(),
  calendarId: text("calendar_id").notNull().unique(),
  /** Google's own name for what is watched; it is needed to end the notice. */
  resourceId: text("resource_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
