import { syncAllGoogleConnections } from "@backend/calendar/google";
import { application } from "./application";
import { router } from "./router";

export { BuildSessionObject } from "@backend/arch-sessions/session-object";
export { BuilderObject } from "@backend/arch-builder/builder-object";
export { AskSessionObject } from "@backend/ask/ask-object";
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
  // Production's cron: keeps every member's imported Google calendars fresh.
  // Previews have no cron; their copies sync when a member opens the calendar.
  scheduled(
    _controller: ScheduledController,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ) {
    if (env.WORKER_ROLE === "application") return;
    ctx.waitUntil(syncAllGoogleConnections());
  },
};
