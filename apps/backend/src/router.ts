import { Hono } from "hono";
import { serveArchApi } from "@backend/arch-api/handler";
import { getAuth, AUTH_BASE_PATH } from "@backend/arch-auth/auth";
import { resolvePrincipal } from "@backend/arch-auth/session";
import { resolveBranch } from "@backend/arch-branches/service";
import { readBranchParam } from "@backend/arch-routing/branch-param";
import { handoff } from "@backend/arch-routing/handoff";
import { missingBranchResponse } from "@backend/arch-routing/missing-branch";
import { openSessionSocket } from "@backend/arch-sessions/service";
import type { ApiContext } from "@backend/commons/api";
import { DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";
import { MAIN_BRANCH } from "@backend/commons/principal";
import { application } from "./application";

const log = logger("backend/router");

/**
 * The router: production's front door. It signs people in, serves everything
 * under /api/arch/* itself, and hands every other request to the application
 * on the branch the request names.
 */
export const router = new Hono<{ Bindings: Cloudflare.Env; Variables: ApiContext }>();

router.onError((err, c) => {
  log.error("unhandled error", { err });
  return c.json({ message: err.message }, 500);
});

router.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => getAuth().handler(c.req.raw));

router.get("/api/arch/health", (c) => c.json({ status: "ok" }));

router.use("*", async (c, next) => {
  c.set("principal", await resolvePrincipal(c.req.raw));
  c.set("branch", readBranchParam(c.req.raw));
  await next();
});

// The build chat socket: the chat procedures are served on the socket itself,
// by the session's Durable Object.
router.get("/api/arch/sessions/:sessionId/ws", async (c) => {
  const principal = c.get("principal");
  if (!principal) return c.json({ message: "Not signed in" }, 401);
  return openSessionSocket(principal, c.req.param("sessionId"), c.req.raw);
});

router.all("/api/arch/*", (c) =>
  serveArchApi(c.req.raw, { principal: c.get("principal"), branch: c.get("branch") }),
);

// Everything else is the application: the SPA, its assets and /api/app/*.
router.all("*", async (c) => {
  const principal = c.get("principal");
  const request = c.req.raw;
  if (!principal) {
    // A signed-out visitor still gets the SPA, which shows the sign-in screen,
    // and only from main: a branch is never served to someone not signed in.
    if (new URL(request.url).pathname.startsWith("/api/")) {
      return c.json({ message: "Not signed in" }, 401);
    }
    return handoff(application, request, null, MAIN_BRANCH, null, c.executionCtx);
  }
  const branch = c.get("branch");
  let target;
  try {
    target = await resolveBranch(branch);
  } catch (err) {
    if (!(err instanceof DomainError && err.code === "NOT_FOUND")) throw err;
    log.info("unknown branch requested", { branch });
    return missingBranchResponse(request, c.env.ASSETS);
  }
  return handoff(application, request, principal, branch, target, c.executionCtx);
});
