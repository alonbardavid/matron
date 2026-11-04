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
};
