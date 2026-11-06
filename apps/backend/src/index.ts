import { logger } from "@backend/commons/logger";
import { sendDueReminders } from "@backend/notifications/reminders";
import { application } from "./application";
import { router } from "./router";

export { BuildSessionObject } from "@backend/arch-sessions/session-object";
export { BuilderObject } from "@backend/arch-builder/builder-object";
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
  /** The hourly cron: push the reminders that are due. */
  async scheduled(controller: ScheduledController, env: Cloudflare.Env): Promise<void> {
    // A Preview's database is a copy of production's; its reminders would repeat main's.
    if (env.WORKER_ROLE === "application") return;
    const result = await sendDueReminders(controller.scheduledTime);
    log.info("reminder sweep finished", { cron: controller.cron, ...result });
  },
};
