import {
  occurrencesStartingBetween,
  type StartingOccurrence,
} from "@backend/calendar/service";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import { dayKey, fromWallClock } from "@backend/commons/time";
import { getDb } from "@backend/db-models/db";
import { reminder } from "@backend/db-models/notifications";
import { knownUserIds } from "@backend/household/users";
import { openTasksDueBetween, type DueTask } from "@backend/tasks/service";
import { vapidKeys, type VapidKeys } from "./env";
import { forgetSubscription, subscriptionsOf, type StoredSubscription } from "./service";
import { sendPush, type PushMessage } from "./web-push";

const log = logger("notifications/reminders");

const DAY_MS = 86_400_000;
/**
 * How far ahead a sweep looks. The sweep runs hourly, on the hour, so a
 * reminder lands between 30 and 90 minutes before its moment, and exactly an
 * hour before anything on the hour. Whatever is sooner than that and was not
 * reminded yet, such as an event added at the last minute, is still reminded.
 */
const LOOKAHEAD_MS = 90 * 60_000;

interface DueReminder {
  /** What the reminder is about; with the person, the row that makes it go out once. */
  subject: string;
  userId: string;
  /** The moment reminded of: the event's start, or the end of the task's due day. */
  at: number;
  message: PushMessage;
}

export interface SweepResult {
  due: number;
  sent: number;
}

/**
 * Pushes a reminder to each attendee of an event about to start and to each
 * assignee (or, with none, the creator) of an open task whose due day is
 * about to end, on every device they subscribed. A task's day ends at
 * midnight in the time zone of the person's latest subscribed device.
 */
export async function sendDueReminders(now: number): Promise<SweepResult> {
  const vapid = vapidKeys();
  if (!vapid) {
    log.info("reminders skipped: no VAPID keys");
    return { due: 0, sent: 0 };
  }
  const until = now + LOOKAHEAD_MS;
  const occurrences = await occurrencesStartingBetween(now, until);
  // Any zone's day that could end in the window: a day either side in UTC covers them all.
  const tasks = await openTasksDueBetween(utcDay(now - DAY_MS), utcDay(until + DAY_MS));
  const people = await knownUserIds([
    ...occurrences.flatMap((o) => o.attendeeIds),
    ...tasks.flatMap((t) => t.remindUserIds),
  ]);
  const devices = await subscriptionsOf(people);

  const due = [
    ...occurrences.flatMap((o) => eventReminders(o, devices)),
    ...tasks.flatMap((t) => taskReminders(t, devices)),
  ].filter((r) => r.at >= now && r.at < until);

  let sent = 0;
  for (const item of due) {
    try {
      if (!(await claim(item))) continue;
      if (await deliver(item, devices.get(item.userId) ?? [], vapid)) sent += 1;
    } catch (err) {
      log.error("reminder failed", { subject: item.subject, userId: item.userId, err });
    }
  }
  return { due: due.length, sent };
}

function eventReminders(
  occurrence: StartingOccurrence,
  devices: Map<string, StoredSubscription[]>,
): DueReminder[] {
  return occurrence.attendeeIds.flatMap((userId) => {
    const latest = devices.get(userId)?.[0];
    if (!latest) return [];
    // An all-day event's day is the event's own; a time reads best in the person's zone.
    const body = occurrence.allDay
      ? `All day, ${formatDay(occurrence.startAt, occurrence.timeZone)}`
      : `Starts at ${formatTime(occurrence.startAt, latest.timeZone)}`;
    return [
      {
        // The start is part of it, so a moved event is reminded of again.
        subject: `event:${occurrence.id}:${occurrence.startAt}`,
        userId,
        at: occurrence.startAt,
        message: {
          title: occurrence.title,
          body,
          url: "/",
          tag: `event:${occurrence.id}`,
        },
      },
    ];
  });
}

function taskReminders(
  task: DueTask,
  devices: Map<string, StoredSubscription[]>,
): DueReminder[] {
  return task.remindUserIds.flatMap((userId) => {
    const latest = devices.get(userId)?.[0];
    if (!latest) return [];
    return [
      {
        subject: `task:${task.id}:${task.dueDate}`,
        userId,
        at: endOfDay(task.dueDate, latest.timeZone),
        message: {
          title: task.title,
          body: "Due today",
          url: "/tasks",
          tag: `task:${task.id}`,
        },
      },
    ];
  });
}

/** Claims the reminder's row; false when an earlier sweep already sent it. */
async function claim(item: DueReminder): Promise<boolean> {
  const claimed = await getDb()
    .insert(reminder)
    .values({ id: newEntityId("REMINDER"), subject: item.subject, userId: item.userId })
    .onConflictDoNothing()
    .returning({ id: reminder.id });
  return claimed.length > 0;
}

/** Pushes to every device of the person; true when at least one took it. */
async function deliver(
  item: DueReminder,
  subscriptions: StoredSubscription[],
  vapid: VapidKeys,
): Promise<boolean> {
  let delivered = false;
  for (const subscription of subscriptions) {
    const outcome = await sendPush(subscription, item.message, vapid, item.at);
    if (outcome === "gone") await forgetSubscription(subscription.id);
    delivered ||= outcome === "delivered";
  }
  log.info("reminder sent", {
    subject: item.subject,
    userId: item.userId,
    devices: subscriptions.length,
    delivered,
  });
  return delivered;
}

function utcDay(ms: number): string {
  const date = new Date(ms);
  return dayKey({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

/** The instant `day` (`YYYY-MM-DD`) ends in `timeZone`: the next day's midnight. */
export function endOfDay(day: string, timeZone: string): number {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, date! + 1));
  return fromWallClock(
    {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

function formatTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);
}

function formatDay(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(ms);
}
