import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, updatedAt } from "./columns";

/** A device that receives push notifications, as its browser subscribed it. */
export const pushSubscription = sqliteTable(
  "push_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** The device's IANA time zone when it subscribed; the person's tasks are due by its days. */
    timeZone: text("time_zone").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("push_subscription_user_idx").on(table.userId)],
);

/** What an alarm is on. */
export const ALARM_KINDS = ["event", "task"] as const;
export type AlarmKind = (typeof ALARM_KINDS)[number];

/**
 * A member's own alarm on an event or a task: how long before it starts or is
 * due they are reminded. One per member and thing; nobody else's is affected.
 */
export const alarm = sqliteTable(
  "alarm",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ALARM_KINDS }).notNull(),
    /** The event's or the task's id. */
    subjectId: text("subject_id").notNull(),
    userId: text("user_id").notNull(),
    minutesBefore: integer("minutes_before").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("alarm_subject_user").on(table.kind, table.subjectId, table.userId),
  ],
);
