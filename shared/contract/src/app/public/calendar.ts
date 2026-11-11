import { oc } from "@orpc/contract";
import { z } from "zod";
import { PUBLIC_APP_PATH } from "./path";

/**
 * Where Google posts that an imported calendar changed. Google is not signed
 * in, and names the notice the import started instead.
 */
export const GOOGLE_PUSH_PATH = `${PUBLIC_APP_PATH}/calendar/google/push`;

export const calendarPublicContract = {
  /**
   * Google's notice that a watched calendar changed, told in headers alone.
   * Answers 404 to a notice the import did not start; a known one syncs its
   * calendar after the answer.
   */
  googlePush: oc
    .route({
      method: "POST",
      path: GOOGLE_PUSH_PATH,
      inputStructure: "detailed",
      successStatus: 204,
    })
    .input(
      z.object({
        headers: z.object({
          "x-goog-channel-id": z.string().min(1).max(64),
          "x-goog-resource-id": z.string().min(1).max(300),
          /** `sync` when the notice begins, then `exists` for each change. */
          "x-goog-resource-state": z.string().max(40).optional(),
        }),
      }),
    ),
};
