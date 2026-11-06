import { and, desc, eq, inArray } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { getDb } from "@backend/db-models/db";
import { pushSubscription } from "@backend/db-models/notifications";
import type {
  PushSettings,
  PushSubscriptionInput,
} from "@shared/contract/app/notifications";
import { vapidKeys } from "./env";
import { pushPermissions } from "./permissions";

const log = logger("notifications/service");

export type StoredSubscription = typeof pushSubscription.$inferSelect;

/** The key a device subscribes with, and which of the caller's devices are subscribed. */
export async function getPushSettings(principal: Principal): Promise<PushSettings> {
  pushPermissions.require(principal, "view");
  const vapid = vapidKeys();
  if (!vapid) return { publicKey: null, endpoints: [] };
  const rows = await getDb()
    .select({ endpoint: pushSubscription.endpoint })
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, principal.userId));
  return { publicKey: vapid.publicKey, endpoints: rows.map((row) => row.endpoint) };
}

/**
 * Subscribes a device to the caller's reminders. An endpoint is one browser
 * on one device, so one already saved for someone else (who signed out
 * there) moves over to the caller.
 */
export async function subscribeDevice(
  principal: Principal,
  { endpoint, keys, timeZone }: PushSubscriptionInput,
): Promise<void> {
  pushPermissions.require(principal, "subscribe");
  if (!isTimeZone(timeZone)) throw new DomainError("BAD_REQUEST", "Unknown time zone");
  await getDb()
    .insert(pushSubscription)
    .values({
      id: newEntityId("PUSH_SUBSCRIPTION"),
      userId: principal.userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      timeZone,
    })
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: {
        userId: principal.userId,
        p256dh: keys.p256dh,
        auth: keys.auth,
        timeZone,
        updatedAt: new Date(),
      },
    });
  log.info("device subscribed", {
    userId: principal.userId,
    host: new URL(endpoint).host,
  });
}

/** Unsubscribes one of the caller's own devices; anyone else's is left alone. */
export async function unsubscribeDevice(
  principal: Principal,
  endpoint: string,
): Promise<void> {
  pushPermissions.require(principal, "unsubscribe");
  const removed = await getDb()
    .delete(pushSubscription)
    .where(
      and(
        eq(pushSubscription.userId, principal.userId),
        eq(pushSubscription.endpoint, endpoint),
      ),
    )
    .returning({ id: pushSubscription.id });
  log.info("device unsubscribed", {
    userId: principal.userId,
    found: removed.length > 0,
  });
}

/** Every subscribed device of these people, newest first, for the reminder sweep. */
export async function subscriptionsOf(
  userIds: readonly string[],
): Promise<Map<string, StoredSubscription[]>> {
  const out = new Map<string, StoredSubscription[]>();
  if (userIds.length === 0) return out;
  const rows = await getDb()
    .select()
    .from(pushSubscription)
    .where(inArray(pushSubscription.userId, [...new Set(userIds)]))
    .orderBy(desc(pushSubscription.updatedAt));
  for (const row of rows) {
    const list = out.get(row.userId) ?? [];
    list.push(row);
    out.set(row.userId, list);
  }
  return out;
}

/** Drops a subscription its push service says no longer exists. */
export async function forgetSubscription(id: string): Promise<void> {
  await getDb().delete(pushSubscription).where(eq(pushSubscription.id, id));
  log.info("forgot a subscription the push service no longer knows", { id });
}

function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
