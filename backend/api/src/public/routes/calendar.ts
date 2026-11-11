import { receiveGooglePush } from "@backend/calendar/google";
import { publicApp } from "../implementer";

export const calendar = publicApp.calendar.router({
  googlePush: publicApp.calendar.googlePush.handler(({ input }) =>
    receiveGooglePush(
      input.headers["x-goog-channel-id"],
      input.headers["x-goog-resource-id"],
      input.headers["x-goog-resource-state"],
    ),
  ),
});
