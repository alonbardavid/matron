import {
  getPushSettings,
  subscribeDevice,
  unsubscribeDevice,
} from "@backend/notifications/service";
import { app } from "../implementer";

export const notifications = app.notifications.router({
  pushSettings: app.notifications.pushSettings.handler(({ context }) =>
    getPushSettings(context.principal),
  ),
  subscribe: app.notifications.subscribe.handler(async ({ context, input }) => {
    await subscribeDevice(context.principal, input);
    return { ok: true as const };
  }),
  unsubscribe: app.notifications.unsubscribe.handler(async ({ context, input }) => {
    await unsubscribeDevice(context.principal, input.endpoint);
    return { ok: true as const };
  }),
});
