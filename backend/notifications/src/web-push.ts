import { encryptNotification } from "@block65/webcrypto-web-push";
import { SignJWT, base64url, importJWK } from "jose";
import { logger } from "@backend/commons/logger";
import type { VapidKeys } from "./env";

const log = logger("notifications/web-push");

/** What the service worker (apps/frontend/public/sw.js) shows. */
export interface PushMessage {
  title: string;
  body: string;
  /** The page a tap opens. */
  url: string;
  /** Notifications with the same tag replace each other on the device. */
  tag: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** `delivered`, `gone` when the push service no longer knows the subscription, or `failed`. */
export type PushOutcome = "delivered" | "gone" | "failed";

const GONE_STATUSES = [404, 410];
const MIN_TTL_SECONDS = 60;

/**
 * Sends one encrypted Web Push message (RFC 8291) with VAPID authentication
 * (RFC 8292). `expiresAt` bounds how long the push service keeps trying a
 * device that is offline: a reminder is worthless once its moment has passed.
 */
export async function sendPush(
  target: PushTarget,
  message: PushMessage,
  vapid: VapidKeys,
  expiresAt: number,
): Promise<PushOutcome> {
  const host = new URL(target.endpoint).host;
  try {
    const ttl = Math.max(MIN_TTL_SECONDS, Math.floor((expiresAt - Date.now()) / 1000));
    const response = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        authorization: `vapid t=${await vapidToken(target.endpoint, vapid)}, k=${vapid.publicKey}`,
        ttl: String(ttl),
        urgency: "normal",
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
      },
      body: await encryptNotification(
        {
          endpoint: target.endpoint,
          expirationTime: null,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        new TextEncoder().encode(JSON.stringify(message)),
      ),
    });
    if (GONE_STATUSES.includes(response.status)) return "gone";
    if (!response.ok) {
      log.warn("push service refused a push", {
        host,
        status: response.status,
        reason: await response.text(),
      });
      return "failed";
    }
    return "delivered";
  } catch (err) {
    log.error("push failed", { host, err });
    return "failed";
  }
}

async function vapidToken(endpoint: string, vapid: VapidKeys): Promise<string> {
  const point = base64url.decode(vapid.publicKey);
  const key = await importJWK(
    {
      kty: "EC",
      crv: "P-256",
      x: base64url.encode(point.slice(1, 33)),
      y: base64url.encode(point.slice(33, 65)),
      d: vapid.privateKey,
    },
    "ES256",
  );
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setAudience(new URL(endpoint).origin)
    .setSubject(vapid.subject)
    .setExpirationTime("12h")
    .sign(key);
}
