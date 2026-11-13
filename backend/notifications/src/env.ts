import { env } from "cloudflare:workers";
import type { AlarmKind } from "@backend/db-models/notifications";
import type { AlarmObject } from "./alarm-object";

/** The bindings push reads; apps/backend/src/env.d.ts is the full declaration. */
interface PushEnv {
  APP_ORIGIN: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  EVENT_ALARMS: DurableObjectNamespace<AlarmObject>;
  TASK_ALARMS: DurableObjectNamespace<AlarmObject>;
}

/** The objects that ring the alarms of one kind: each feature's own class. */
export function alarmObjects(kind: AlarmKind): DurableObjectNamespace<AlarmObject> {
  const { EVENT_ALARMS, TASK_ALARMS } = env as unknown as PushEnv;
  return kind === "event" ? EVENT_ALARMS : TASK_ALARMS;
}

export interface VapidKeys {
  /** The uncompressed P-256 point, base64url: what a browser subscribes with. */
  publicKey: string;
  /** The private scalar (a JWK's `d`), base64url. */
  privateKey: string;
  /** Who push services contact about this sender. */
  subject: string;
}

/**
 * The deployment's VAPID key pair, or null where push is off: a Preview holds
 * no keys, so a branch neither offers push nor sends any.
 */
export function vapidKeys(): VapidKeys | null {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, APP_ORIGIN } = env as unknown as PushEnv;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null;
  return {
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
    subject: APP_ORIGIN,
  };
}
