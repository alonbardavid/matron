import { env } from "cloudflare:workers";
import type { MiddlewareHandler } from "hono";
import type { Principal } from "@backend/commons/principal";
import { verifyHandoff } from "./signed-handoff";

/** What the application knows about a request: who, if anyone, and which branch. */
export type ApplicationVariables = { principal: Principal | null; branch: string };

/**
 * The application trusts only the router's signed handoff. A Preview reached
 * directly, or a request that skipped the router, is refused here.
 */
export const requireHandoff: MiddlewareHandler<{
  Variables: ApplicationVariables;
}> = async (c, next) => {
  const { SIGNING_KEY } = env as unknown as { SIGNING_KEY: string };
  const handoff = await verifyHandoff(SIGNING_KEY, c.req.raw.headers);
  if (!handoff) {
    return c.json({ message: "Requests must come through the router" }, 401);
  }
  c.set("principal", handoff.principal);
  c.set("branch", handoff.branch);
  await next();
};
