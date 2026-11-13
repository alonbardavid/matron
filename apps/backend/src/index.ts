import { GOOGLE_SYNC_CRON, syncAllGoogleConnections } from "@backend/calendar/google";
import { application } from "./application";
import { router } from "./router";

export { BuildSessionObject } from "@backend/arch-sessions/session-object";
export { BuilderObject } from "@backend/arch-builder/builder-object";
// Each builder run is a child of its session; the handle class is found by name when a run starts.
export { BuilderRunHandle } from "@backend/arch-builder/run-handle";
export { AskSessionObject } from "@backend/ask/ask-object";
// One member's alarm on one event or task; each rings on its own schedule.
export { EventAlarmObject } from "@backend/calendar/event-alarm-object";
export { TaskAlarmObject } from "@backend/tasks/task-alarm-object";
// Adds the coding agent's credentials to its model requests outside the container.
export { ContainerEgress } from "agents/harness/container";

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
  // Production's cron; a Preview has none. Daily, every member's imported
  // Google calendars are synced and Google's notices renewed, which bring each
  // change in between; a member syncs a branch's copy from their settings.
  scheduled(
    controller: ScheduledController,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ): void {
    if (env.WORKER_ROLE === "application") return;
    switch (controller.cron) {
      case GOOGLE_SYNC_CRON:
        ctx.waitUntil(syncAllGoogleConnections());
        return;
      default:
        throw new Error(`No job runs on the cron "${controller.cron}"`);
    }
  },
};
