import {
  cancelOccurrence,
  createEvent,
  editOccurrence,
  getEvent,
  listOccurrences,
  placeEvent,
  removeEvent,
  stopRecurrence,
  updateEvent,
} from "@backend/calendar/service";
import {
  createCalendar,
  listCalendars,
  removeCalendar,
  updateCalendar,
} from "@backend/calendar/calendars";
import {
  disconnectGoogle,
  getGoogleStatus,
  listGoogleCalendars,
  selectGoogleCalendars,
  syncGoogleCalendar,
} from "@backend/calendar/google";
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
  editOccurrence: app.calendar.editOccurrence.handler(
    ({ context, input: { id, originalStartAt, ...changes } }) =>
      editOccurrence(context.principal, id, originalStartAt, changes),
  ),
  cancelOccurrence: app.calendar.cancelOccurrence.handler(({ context, input }) =>
    cancelOccurrence(context.principal, input.id, input.originalStartAt),
  ),
  place: app.calendar.place.handler(({ context, input }) =>
    placeEvent(context.principal, input.id, input.calendarId),
  ),
  calendars: app.calendar.calendars.router({
    list: app.calendar.calendars.list.handler(({ context }) =>
      listCalendars(context.principal),
    ),
    create: app.calendar.calendars.create.handler(({ context, input }) =>
      createCalendar(context.principal, input),
    ),
    update: app.calendar.calendars.update.handler(
      ({ context, input: { id, ...changes } }) =>
        updateCalendar(context.principal, id, changes),
    ),
    remove: app.calendar.calendars.remove.handler(async ({ context, input }) => {
      await removeCalendar(context.principal, input.id);
      return { ok: true as const };
    }),
  }),
  google: app.calendar.google.router({
    status: app.calendar.google.status.handler(({ context }) =>
      getGoogleStatus(context.principal, context.branch),
    ),
    calendars: app.calendar.google.calendars.handler(({ context }) =>
      listGoogleCalendars(context.principal),
    ),
    select: app.calendar.google.select.handler(({ context, input }) =>
      selectGoogleCalendars(context.principal, context.branch, input.calendarIds),
    ),
    sync: app.calendar.google.sync.handler(({ context }) =>
      syncGoogleCalendar(context.principal, context.branch),
    ),
    disconnect: app.calendar.google.disconnect.handler(({ context }) =>
      disconnectGoogle(context.principal, context.branch),
    ),
  }),
});
