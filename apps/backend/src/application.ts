import { Hono } from "hono";
import { serveAppApi } from "@backend/api/handler";
import { servePublicAppApi } from "@backend/api/public/handler";
import { openAskSocket } from "@backend/ask/socket";
import { answerError } from "@backend/commons/errors";
import {
  requireHandoff,
  type ApplicationVariables,
} from "@backend/arch-routing/require-handoff";
import { logger } from "@backend/commons/logger";
import { PUBLIC_APP_PATH } from "@shared/contract/app/public/path";

const log = logger("backend/application");

/**
 * The application: what a branch changes. It only ever sees requests the
 * router signed, whether they arrived in-process (main) or over the network
 * (a Preview). Everything that is not /api/app/* is the SPA and its assets.
 */
export const application = new Hono<{ Variables: ApplicationVariables }>();

application.onError(answerError);

application.use("*", requireHandoff);

// The public procedures answer anyone the router let through, signed in or not.
application.use(`${PUBLIC_APP_PATH}/*`, async (c, next) => {
  const response = await servePublicAppApi(c.req.raw, {
    principal: c.get("principal"),
    branch: c.get("branch"),
  });
  return response ?? next();
});

application.use("/api/app/*", async (c, next) => {
  // A signed-out visitor reaches the SPA but not the API, which requires a principal.
  const { latitude, longitude } = (c.req.raw.cf ?? {}) as IncomingRequestCfProperties;
  const response = await serveAppApi(c.req.raw, {
    principal: c.get("principal"),
    branch: c.get("branch"),
    coordinates: { latitude, longitude },
  });
  return response ?? next();
});

// The assistant's chat socket, served by the ask session's object.
application.get("/api/app/ask/:id/ws", async (c) => {
  const principal = c.get("principal");
  if (!principal) return c.json({ message: "Not signed in" }, 401);
  return openAskSocket(principal, c.get("branch"), c.req.param("id"), c.req.raw);
});

application.all("/api/*", (c) => c.json({ message: "No such application route" }, 404));

application.get("*", async (c) => {
  const assets = (c.env as Cloudflare.Env | undefined)?.ASSETS;
  if (!assets) {
    log.error("ASSETS binding missing");
    return c.text("Assets are not bound", 500);
  }
  return assets.fetch(c.req.raw);
});
