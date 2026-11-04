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
  recurrence: recurrenceSchema.nullable().optional(),
  sharedWith: userIds.optional(),
  attendees: userIds.optional(),
});
export type CalendarEventCreate = z.infer<typeof calendarEventCreateSchema>;

export const calendarEventUpdateSchema = calendarEventCreateSchema.partial();
export type CalendarEventUpdate = z.infer<typeof calendarEventUpdateSchema>;

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
};
