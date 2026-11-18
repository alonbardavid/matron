import type { MiddlewareHandler } from "hono";
import type { ApiContext } from "@backend/commons/api";
import { serveSessionSocket } from "./service";

/**
 * The build chat's socket path and everything below it, for the router to
 * mount with the session's id as `:sessionId`. The chat's library decides what
 * is asked for there (the socket itself, the messages so far before it
 * connects), and the session's Durable Object is what answers it, so no path
 * is named here: a request the object does not know gets the object's own
 * refusal.
 */
export const sessionSocketRouter: MiddlewareHandler<{ Variables: ApiContext }> = async (
  c,
  next,
) => {
  const sessionId = c.req.param("sessionId");
  if (c.req.method !== "GET" || !sessionId) return next();
  const principal = c.get("principal");
  if (!principal) return c.json({ message: "Not signed in" }, 401);
  return serveSessionSocket(principal, sessionId, c.req.raw);
};
