import { Hono } from "hono";
import { serveAppApi } from "@backend/api/handler";
import {
  requireHandoff,
  type ApplicationVariables,
} from "@backend/arch-routing/require-handoff";
import { logger } from "@backend/commons/logger";

const log = logger("backend/application");

/**
 * The application: what a branch changes. It only ever sees requests the
 * router signed, whether they arrived in-process (main) or over the network
 * (a Preview). Everything that is not /api/app/* is the SPA and its assets.
 */
export const application = new Hono<{ Variables: ApplicationVariables }>();

application.use("*", requireHandoff);

application.use("/api/app/*", async (c, next) => {
  // A signed-out visitor reaches the SPA but not the API, which requires a principal.
  const response = await serveAppApi(c.req.raw, {
    principal: c.get("principal"),
    branch: c.get("branch"),
  });
  return response ?? next();
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
