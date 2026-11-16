import { oc } from "@orpc/contract";
import { z } from "zod";

/** What a device needs to subscribe, and which of the caller's devices already have. */
export const pushSettingsSchema = z.object({
  /** The VAPID public key, or null where this deployment sends no push (a Preview). */
  publicKey: z.string().nullable(),
  /** The push endpoints of the caller's subscribed devices. */
  endpoints: z.array(z.string()),
});
export type PushSettings = z.infer<typeof pushSettingsSchema>;

const endpoint = z
  .string()
  .url()
  .max(2000)
  .refine((value) => value.startsWith("https://"), "A push endpoint is an https URL");

/** A browser's `PushSubscription`, with the time zone the device is in. */
export const pushSubscriptionInputSchema = z.object({
  endpoint,
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
  timeZone: z.string().min(1).max(100),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;

/** How long before an event starts or a task is due an alarm can ring, in minutes. */
export const ALARM_MINUTES = [5, 10, 15, 30, 60, 120] as const;
export type AlarmMinutes = (typeof ALARM_MINUTES)[number];

/** The caller's own alarm on an event or a task; `minutesBefore` is null when they set none. */
export const alarmSchema = z.object({
  minutesBefore: z.literal(ALARM_MINUTES).nullable(),
});
export type Alarm = z.infer<typeof alarmSchema>;

const ok = z.object({ ok: z.literal(true) });

export const notificationsContract = {
  pushSettings: oc
    .route({ method: "GET", path: "/api/app/notifications/push" })
    .output(pushSettingsSchema),
  /** Subscribes this device to the caller's reminders; a device signed in as someone else moves over. */
  subscribe: oc
    .route({ method: "POST", path: "/api/app/notifications/push/subscriptions" })
    .input(pushSubscriptionInputSchema)
    .output(ok),
  unsubscribe: oc
    .route({ method: "POST", path: "/api/app/notifications/push/subscriptions/remove" })
    .input(z.object({ endpoint: z.string().max(2000) }))
    .output(ok),
};
