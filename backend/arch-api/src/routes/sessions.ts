import {
  archiveSession,
  clearSession,
  createSession,
  listSessions,
} from "@backend/arch-sessions/service";
import { arch } from "../implementer";

export const sessions = arch.sessions.router({
  list: arch.sessions.list.handler(({ context }) => listSessions(context.principal)),
  create: arch.sessions.create.handler(({ context }) => createSession(context.principal)),
  archive: arch.sessions.archive.handler(({ context, input }) =>
    archiveSession(context.principal, input.id),
  ),
  clear: arch.sessions.clear.handler(({ context, input }) =>
    clearSession(context.principal, input.id),
  ),
});
