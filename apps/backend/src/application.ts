import { Hono } from "hono";
import { serveAppApi } from "@backend/api/handler";
import { openAskSocket } from "@backend/ask/socket";
import { finishGoogleConnect } from "@backend/calendar/google";
import {
  requireHandoff,
  type ApplicationVariables,
} from "@backend/arch-routing/require-handoff";
import { logger } from "@backend/commons/logger";
import { GOOGLE_CALLBACK_PATH } from "@shared/contract/app/calendar";

const log = logger("backend/application");

/**
 * The application: what a branch changes. It only ever sees requests the
 * router signed, whether they arrived in-process (main) or over the network
 * (a Preview). Everything that is not /api/app/* is the SPA and its assets.
 */
export const application = new Hono<{ Variables: ApplicationVariables }>();

application.use("*", requireHandoff);

// Google sends the browser back here after the member allowed calendar access:
// a navigation, so it answers with a redirect rather than a procedure's JSON.
application.get(GOOGLE_CALLBACK_PATH, async (c) => {
  const principal = c.get("principal");
  if (!principal) return c.redirect("/");
  try {
    return c.redirect(await finishGoogleConnect(principal, new URL(c.req.url)));
  } catch (err) {
    log.error("google callback failed", { err, userId: principal.userId });
    return c.redirect("/settings?google=failed");
  }
});

application.use("/api/app/*", async (c, next) => {
  // A signed-out visitor reaches the SPA but not the API, which requires a principal.
  const response = await serveAppApi(c.req.raw, {
    principal: c.get("principal"),
    branch: c.get("branch"),
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
