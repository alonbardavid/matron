import type { PushSubscriptionInput } from "@shared/contract/app/notifications";
import { isIosSafari, isRunningInstalled } from "./installPrompt";

/**
 * Whether this device can turn reminders on: `needs-install` on iOS, where
 * only an app added to the Home Screen gets push; `blocked` once the person
 * refused notifications for the site.
 */
export type PushAvailability = "needs-install" | "unsupported" | "blocked" | "available";

const SERVICE_WORKER_URL = "/sw.js";

export function pushAvailability(): PushAvailability {
  if (!canReceivePush()) {
    return isIosSafari() && !isRunningInstalled() ? "needs-install" : "unsupported";
  }
  return Notification.permission === "denied" ? "blocked" : "available";
}

/** Registers the service worker that shows reminders; call once at startup. */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => {});
}

export async function currentPushEndpoint(): Promise<string | null> {
  return (await currentSubscription())?.endpoint ?? null;
}

/** Asks for permission and subscribes; null when the person said no. */
export async function subscribeThisDevice(
  publicKey: string,
): Promise<PushSubscriptionInput | null> {
  if ((await Notification.requestPermission()) !== "granted") return null;
  const subscription = await subscriptionFor(publicKey);
  const { keys } = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: keys?.p256dh ?? "", auth: keys?.auth ?? "" },
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export async function unsubscribeThisDevice(): Promise<void> {
  await (await currentSubscription())?.unsubscribe();
}

function canReceivePush(): boolean {
  return (
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
  );
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** The device's subscription for this key, made anew when it was made for another. */
async function subscriptionFor(publicKey: string): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.ready;
  const key = decodeBase64Url(publicKey);
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    if (sameKey(existing.options.applicationServerKey, key)) return existing;
    await existing.unsubscribe();
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
}

function sameKey(actual: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (!actual) return false;
  const bytes = new Uint8Array(actual);
  return bytes.length === expected.length && bytes.every((b, i) => b === expected[i]);
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
