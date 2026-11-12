import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";

/** What is on the calendar between two instants, series expanded. */
export function useOccurrences(from: number, to: number) {
  return useQuery(
    orpc.calendar.occurrences.queryOptions({ input: { from, to }, staleTime: 10_000 }),
  );
}

export function useEvent(id: string | null) {
  return useQuery(
    orpc.calendar.get.queryOptions({ input: { id: id ?? "" }, enabled: id !== null }),
  );
}

export function useEventActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.calendar.key() });
  const create = useMutation(
    orpc.calendar.create.mutationOptions({ onSuccess: refresh }),
  );
  const update = useMutation(
    orpc.calendar.update.mutationOptions({ onSuccess: refresh }),
  );
  const stop = useMutation(
    orpc.calendar.stop.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not stop the repetition"),
    }),
  );
  const remove = useMutation(
    orpc.calendar.remove.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not remove the event"),
    }),
  );
  const place = useMutation(
    orpc.calendar.place.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not move the event"),
    }),
  );
  const editOccurrence = useMutation(
    orpc.calendar.editOccurrence.mutationOptions({ onSuccess: refresh }),
  );
  const cancelOccurrence = useMutation(
    orpc.calendar.cancelOccurrence.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not remove the event"),
    }),
  );
  const hide = useMutation(
    orpc.calendar.hide.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not change the event"),
    }),
  );
  const attachFile = useMutation(
    orpc.calendar.attachFile.mutationOptions({ onSuccess: refresh }),
  );
  const attachLink = useMutation(
    orpc.calendar.attachLink.mutationOptions({ onSuccess: refresh }),
  );
  const reply = useMutation(orpc.calendar.reply.mutationOptions({ onSuccess: refresh }));
  const detach = useMutation(
    orpc.calendar.detach.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not remove the attachment"),
    }),
  );
  return {
    create,
    update,
    stop,
    remove,
    place,
    editOccurrence,
    cancelOccurrence,
    hide,
    attachFile,
    attachLink,
    detach,
    reply,
  };
}

/** The caller's own calendars. */
export function useCalendars() {
  return useQuery(orpc.calendar.calendars.list.queryOptions({ staleTime: 10_000 }));
}

export function useCalendarActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.calendar.key() });
  const create = useMutation(
    orpc.calendar.calendars.create.mutationOptions({ onSuccess: refresh }),
  );
  const update = useMutation(
    orpc.calendar.calendars.update.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not change the calendar"),
    }),
  );
  const remove = useMutation(
    orpc.calendar.calendars.remove.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not remove the calendar"),
    }),
  );
  return { create, update, remove };
}

export function useGoogleStatus() {
  return useQuery(orpc.calendar.google.status.queryOptions({ staleTime: 30_000 }));
}

/** The household's event labels. */
export function useLabels() {
  return useQuery(orpc.calendar.labels.list.queryOptions({ staleTime: 30_000 }));
}

export function useLabelActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.calendar.key() });
  const create = useMutation(
    orpc.calendar.labels.create.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not add the label"),
    }),
  );
  const update = useMutation(
    orpc.calendar.labels.update.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not change the label"),
    }),
  );
  const remove = useMutation(
    orpc.calendar.labels.remove.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not remove the label"),
    }),
  );
  return { create, update, remove };
}

/** Where an occurrence is moved or resized to. */
export interface EventMove {
  /** The occurrence's id on the calendar. */
  occurrenceId: string;
  eventId: string;
  /** For an occurrence of a series: which one, so it alone moves. */
  originalStartAt: number | null;
  startAt: number;
  endAt: number;
}

/**
 * Moves or resizes what is on the calendar between `from` and `to`: shown in
 * its new place at once, then saved; put back if saving fails. An occurrence
 * of a series moves alone, as "this event" would in the dialog.
 */
export function useMoveEvent(from: number, to: number) {
  const queryClient = useQueryClient();
  const key = orpc.calendar.occurrences.queryKey({ input: { from, to } });
  const update = useMutation(orpc.calendar.update.mutationOptions());
  const editOccurrence = useMutation(orpc.calendar.editOccurrence.mutationOptions());
  return async (move: EventMove) => {
    await queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData(key, (old) =>
      old?.map((item) =>
        item.id === move.occurrenceId
          ? { ...item, startAt: move.startAt, endAt: move.endAt, changed: true }
          : item,
      ),
    );
    try {
      if (move.originalStartAt !== null) {
        await editOccurrence.mutateAsync({
          id: move.eventId,
          originalStartAt: move.originalStartAt,
          startAt: move.startAt,
          endAt: move.endAt,
        });
      } else {
        await update.mutateAsync({
          id: move.eventId,
          startAt: move.startAt,
          endAt: move.endAt,
        });
      }
    } catch (err) {
      notifyError(err, "Could not move the event");
    } finally {
      await queryClient.invalidateQueries({ queryKey: orpc.calendar.key() });
    }
  };
}
