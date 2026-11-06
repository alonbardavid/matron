import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
    /** The device's IANA time zone when it subscribed; a task's due day ends in it. */
    timeZone: text("time_zone").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("push_subscription_user_idx").on(table.userId)],
);

/** A reminder that went out: claimed before sending, so it goes out once. */
export const reminder = sqliteTable(
  "reminder",
  {
    id: text("id").primaryKey(),
    /** What the reminder is about, e.g. `event:<occurrence id>:<start>` or `task:<id>:<due day>`. */
    subject: text("subject").notNull(),
    userId: text("user_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("reminder_subject_user").on(table.subject, table.userId)],
);
