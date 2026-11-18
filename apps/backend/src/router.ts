import { Hono } from "hono";
import { serveArchApi } from "@backend/arch-api/handler";
import { getAuth, AUTH_BASE_PATH } from "@backend/arch-auth/auth";
import { resolvePrincipal } from "@backend/arch-auth/session";
import { resolveBranch } from "@backend/arch-branches/service";
import { readBranchParam } from "@backend/arch-routing/branch-param";
import { handoff } from "@backend/arch-routing/handoff";
import { answerError } from "@backend/commons/errors";
import { missingBranchResponse } from "@backend/arch-routing/missing-branch";
import { sessionSocketRouter } from "@backend/arch-sessions/socket";
import type { ApiContext } from "@backend/commons/api";
import { DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";
import { MAIN_BRANCH } from "@backend/commons/principal";
import { PUBLIC_APP_PATH } from "@shared/contract/app/public/path";
import { application } from "./application";

const log = logger("backend/router");

/**
 * The router: production's front door. It signs people in, serves everything
 * under /api/arch/* itself, and hands every other request to the application
 * on the branch the request names.
 */
export const router = new Hono<{ Bindings: Cloudflare.Env; Variables: ApiContext }>();

router.onError(answerError);

router.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => getAuth().handler(c.req.raw));

router.get("/api/arch/health", (c) => c.json({ status: "ok" }));

router.use("*", async (c, next) => {
  c.set("principal", await resolvePrincipal(c.req.raw));
  c.set("branch", readBranchParam(c.req.raw));
  await next();
});

// The build chat socket and what the chat asks for beside it: the chat procedures
// are served on the socket itself, by the session's Durable Object.
router.use("/api/arch/sessions/:sessionId/ws/*", sessionSocketRouter);

router.all("/api/arch/*", (c) =>
  serveArchApi(c.req.raw, { principal: c.get("principal"), branch: c.get("branch") }),
);

// Everything else is the application: the SPA, its assets and /api/app/*.
router.all("*", async (c) => {
  const principal = c.get("principal");
  const request = c.req.raw;
  if (!principal) {
    // A signed-out visitor still gets the SPA, which shows the sign-in screen,
    // and the application's public procedures, and only from main: a branch
    // is never served to someone not signed in.
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/") && !pathname.startsWith(`${PUBLIC_APP_PATH}/`)) {
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
