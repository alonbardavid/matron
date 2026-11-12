import { syncAllGoogleConnections } from "@backend/calendar/google";
import { logger } from "@backend/commons/logger";
import { REMINDER_CRON, sendDueReminders } from "@backend/notifications/reminders";
import { application } from "./application";
import { router } from "./router";

export { BuildSessionObject } from "@backend/arch-sessions/session-object";
export { BuilderObject } from "@backend/arch-builder/builder-object";
// Each builder run is a child of its session; the handle class is found by name when a run starts.
export { BuilderRunHandle } from "@backend/arch-builder/run-handle";
export { AskSessionObject } from "@backend/ask/ask-object";
// Adds the coding agent's credentials to its model requests outside the container.
export { ContainerEgress } from "agents/harness/container";

const log = logger("backend/index");

// Production runs the router; a fork (a Preview) runs only the application.
export default {
  fetch(
    request: Request,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ): Response | Promise<Response> {
    return env.WORKER_ROLE === "application"
      ? application.fetch(request, env, ctx)
      : router.fetch(request, env, ctx);
  },
  // Production's crons; a Preview has neither. Hourly, the reminders that are
  // due are pushed: a Preview's database is a copy of production's, so its
  // reminders would repeat main's. Daily, every member's imported Google
  // calendars are synced and Google's notices renewed, which bring each change
  // in between; a member syncs a branch's copy from their settings.
  async scheduled(
    controller: ScheduledController,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (env.WORKER_ROLE === "application") return;
    if (controller.cron !== REMINDER_CRON) {
      ctx.waitUntil(syncAllGoogleConnections());
      return;
    }
    const result = await sendDueReminders(controller.scheduledTime);
    log.info("reminder sweep finished", { cron: controller.cron, ...result });
  },
};
