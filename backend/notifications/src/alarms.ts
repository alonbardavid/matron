import { and, eq, inArray } from "drizzle-orm";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import { getDb } from "@backend/db-models/db";
import { alarm, type AlarmKind } from "@backend/db-models/notifications";
import type { AlarmMinutes } from "@shared/contract/app/notifications";
import { alarmObjects } from "./env";
import type { PushMessage } from "./web-push";

const log = logger("notifications/alarms");

/** D1 takes about a hundred parameters in one statement. */
const ID_CHUNK = 90;

/**
 * Alarms: a member asks to be reminded some minutes before an event starts or
 * a task is due. The row here is what they asked for; a Durable Object of its
 * own (alarm-object.ts) rings it. The feature the thing belongs to decides who
 * may set one and when it rings; these act for no one.
 */

/** One ring of an alarm, as the feature its thing belongs to works it out. */
export interface AlarmRing {
  /** When to ring. */
  ringAt: number;
  /** The moment reminded of: the occurrence's start, or the end of the task's due day. */
  at: number;
  message: PushMessage;
  /** Due all the same, but not pushed: the member hid the event. */
  muted: boolean;
}

/** How long before the thing the member's alarm rings, in minutes; null when they set none. */
export async function alarmMinutesOf(
  kind: AlarmKind,
  subjectId: string,
  userId: string,
): Promise<AlarmMinutes | null> {
  const row = await getDb()
    .select({ minutesBefore: alarm.minutesBefore })
    .from(alarm)
    .where(mine(kind, subjectId, userId))
    .get();
  return (row?.minutesBefore as AlarmMinutes | undefined) ?? null;
}

/** Sets, changes or (null) removes the member's alarm, and arms its object to match. */
export async function setAlarm(
  kind: AlarmKind,
  subjectId: string,
  userId: string,
  minutesBefore: AlarmMinutes | null,
): Promise<void> {
  if (minutesBefore === null) {
    await forgetAlarm(kind, subjectId, userId);
  } else {
    await getDb()
      .insert(alarm)
      .values({ id: newEntityId("ALARM"), kind, subjectId, userId, minutesBefore })
      .onConflictDoUpdate({
        target: [alarm.kind, alarm.subjectId, alarm.userId],
        set: { minutesBefore, updatedAt: new Date() },
      });
  }
  await arm(kind, subjectId, userId);
  log.info("alarm set", { kind, subjectId, userId, minutesBefore });
}

/**
 * Arms every member's alarm on these things again, after their times may have
 * changed. Never throws: the change that led here has already been made.
 */
export async function rearmAlarms(
  kind: AlarmKind,
  subjectIds: readonly string[],
): Promise<void> {
  try {
    for (const row of await alarmsOn(kind, subjectIds)) {
      await arm(kind, row.subjectId, row.userId);
    }
  } catch (err) {
    log.error("alarms not armed again", { kind, err });
  }
}

/** Removes every member's alarm on these things, which are gone. Never throws. */
export async function dropAlarms(
  kind: AlarmKind,
  subjectIds: readonly string[],
): Promise<void> {
  try {
    const rows = await alarmsOn(kind, subjectIds);
    for (const row of rows) {
      await forgetAlarm(kind, row.subjectId, row.userId);
      await arm(kind, row.subjectId, row.userId);
    }
  } catch (err) {
    log.error("alarms not dropped", { kind, err });
  }
}

/** Removes the member's alarm row alone; its object finds nothing to ring. */
export async function forgetAlarm(
  kind: AlarmKind,
  subjectId: string,
  userId: string,
): Promise<void> {
  await getDb()
    .delete(alarm)
    .where(mine(kind, subjectId, userId));
}

function mine(kind: AlarmKind, subjectId: string, userId: string) {
  return and(
    eq(alarm.kind, kind),
    eq(alarm.subjectId, subjectId),
    eq(alarm.userId, userId),
  );
}

/** The alarms on these things; a long list is matched here instead, as few alarms are set. */
async function alarmsOn(
  kind: AlarmKind,
  subjectIds: readonly string[],
): Promise<{ subjectId: string; userId: string }[]> {
  if (subjectIds.length === 0) return [];
  const columns = { subjectId: alarm.subjectId, userId: alarm.userId };
  const db = getDb();
  if (subjectIds.length <= ID_CHUNK) {
    return db
      .select(columns)
      .from(alarm)
      .where(and(eq(alarm.kind, kind), inArray(alarm.subjectId, [...subjectIds])));
  }
  const among = new Set(subjectIds);
  const rows = await db.select(columns).from(alarm).where(eq(alarm.kind, kind));
  return rows.filter((row) => among.has(row.subjectId));
}

/** Has the alarm's own object schedule its next ring, or none when nothing is ahead. */
function arm(kind: AlarmKind, subjectId: string, userId: string): Promise<void> {
  return alarmObjects()
    .getByName(`${kind}:${subjectId}:${userId}`)
    .arm(kind, subjectId, userId);
}
