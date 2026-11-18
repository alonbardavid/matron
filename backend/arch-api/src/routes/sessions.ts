import type { Handler } from "hono";
import { proxyToBuildSession } from "@backend/arch-sessions/proxy";
import {
  archiveSession,
  clearSession,
  createSession,
  listSessions,
} from "@backend/arch-sessions/service";
import type { ApiContext } from "@backend/commons/api";
import { arch } from "../implementer";

export const sessions = arch.sessions.router({
  list: arch.sessions.list.handler(({ context }) => listSessions(context.principal)),
  create: arch.sessions.create.handler(({ context }) =>
    createSession(context.principal, context.branch),
  ),
  archive: arch.sessions.archive.handler(({ context, input }) =>
    archiveSession(context.principal, input.id),
  ),
  clear: arch.sessions.clear.handler(({ context, input }) =>
    clearSession(context.principal, input.id),
  ),
});

/**
 * The build chat's socket path and everything below it, for the router to
 * mount with the session's id as `:sessionId`. No path is named here: the
 * chat's library decides what is asked for there, and the session's Durable
 * Object answers it.
 */
export const sessionProxyRoute: Handler<{ Variables: ApiContext }, "/:sessionId"> = (
  c,
) => {
  const principal = c.get("principal");
  if (!principal) return c.json({ message: "Not signed in" }, 401);
  return proxyToBuildSession(principal, c.req.param("sessionId"), c.req.raw);
};
