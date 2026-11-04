import {
  createEvent,
  getEvent,
  listOccurrences,
  removeEvent,
  stopRecurrence,
  updateEvent,
} from "@backend/calendar/service";
import { app } from "../implementer";

export const calendar = app.calendar.router({
  occurrences: app.calendar.occurrences.handler(({ context, input }) =>
    listOccurrences(context.principal, input.from, input.to),
  ),
  get: app.calendar.get.handler(({ context, input }) =>
    getEvent(context.principal, input.id),
  ),
  create: app.calendar.create.handler(({ context, input }) =>
    createEvent(context.principal, input),
  ),
  update: app.calendar.update.handler(({ context, input: { id, ...changes } }) =>
    updateEvent(context.principal, id, changes),
  ),
  stop: app.calendar.stop.handler(({ context, input }) =>
    stopRecurrence(context.principal, input.id, input.from),
  ),
  remove: app.calendar.remove.handler(async ({ context, input }) => {
    await removeEvent(context.principal, input.id);
    return { ok: true as const };
  }),
});
