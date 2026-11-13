import {
  attachFileToEvent,
  attachLinkToEvent,
  cancelOccurrence,
  detachFromEvent,
  createEvent,
  editOccurrence,
  getEvent,
  hideEvent,
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
import { placeDetails, suggestPlaces } from "@backend/calendar/places";
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
    await removeEvent(context.principal, input.id, context.branch);
    return { ok: true as const };
  }),
  editOccurrence: app.calendar.editOccurrence.handler(
    ({ context, input: { id, originalStartAt, ...changes } }) =>
      editOccurrence(context.principal, id, originalStartAt, changes),
  ),
  cancelOccurrence: app.calendar.cancelOccurrence.handler(({ context, input }) =>
    cancelOccurrence(context.principal, input.id, input.originalStartAt),
  ),
  attachFile: app.calendar.attachFile.handler(async ({ context, input }) => {
    // The contract's File is the browser's; the Worker's has the same shape.
    const file = input.file as unknown as Blob & { name: string; type: string };
    return attachFileToEvent(context.principal, context.branch, input.id, {
      bytes: new Uint8Array(await file.arrayBuffer()),
      name: file.name,
      mimeType: file.type,
    });
  }),
  attachLink: app.calendar.attachLink.handler(({ context, input }) =>
    attachLinkToEvent(context.principal, input.id, input.url, input.title),
  ),
  detach: app.calendar.detach.handler(({ context, input }) =>
    detachFromEvent(context.principal, context.branch, input.id, input.attachmentId),
  ),
  hide: app.calendar.hide.handler(({ context, input }) =>
    hideEvent(context.principal, input.id, input.hidden),
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
  places: app.calendar.places.handler(({ context, input }) =>
    suggestPlaces(context.principal, input, context.coordinates),
  ),
  placeDetails: app.calendar.placeDetails.handler(({ context, input }) =>
    placeDetails(context.principal, input),
  ),
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
