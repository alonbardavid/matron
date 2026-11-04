import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, timestamp, updatedAt } from "./columns";

export const RECURRENCE_FREQUENCIES = ["weekly", "monthly"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const calendarEvent = sqliteTable("calendar_event", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  creatorId: text("creator_id").notNull(),
  allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  timeZone: text("time_zone").notNull(),
  recurrenceFrequency: text("recurrence_frequency", { enum: RECURRENCE_FREQUENCIES }),
  /** JSON array of weekdays (0 Sunday to 6 Saturday) or days of the month. */
  recurrenceDays: text("recurrence_days"),
  /** The last day an occurrence may fall on, `YYYY-MM-DD`. */
  recurrenceUntil: text("recurrence_until"),
  recurrenceCount: integer("recurrence_count"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const calendarEventShare = sqliteTable(
  "calendar_event_share",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    userId: text("user_id").notNull(),
    attendee: integer("attendee", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("calendar_event_share_event_user").on(table.eventId, table.userId),
  ],
);
