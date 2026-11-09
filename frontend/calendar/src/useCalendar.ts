import { useEffect, useRef } from "react";
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
  return { create, update, stop, remove, place, editOccurrence, cancelOccurrence, hide };
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

/** How old an import may get before opening the calendar syncs it again. */
const STALE_AFTER_MS = 15 * 60_000;

/**
 * Syncs the caller's Google Calendar once when the calendar opens on stale
 * data, then reloads what is shown. Production also syncs on a schedule; a
 * branch only this way.
 */
export function useGoogleAutoSync() {
  const queryClient = useQueryClient();
  const status = useGoogleStatus();
  const sync = useMutation(
    orpc.calendar.google.sync.mutationOptions({
      onSuccess: (data) => {
        queryClient.setQueryData(orpc.calendar.google.status.queryKey(), data);
        void queryClient.invalidateQueries({ queryKey: orpc.calendar.occurrences.key() });
      },
    }),
  );
  const tried = useRef(false);
  const connection = status.data?.connection;
  useEffect(() => {
    if (tried.current || !status.data?.configured || !connection) return;
    if (connection.status !== "active") return;
    if (connection.lastSyncedAt && Date.now() - connection.lastSyncedAt < STALE_AFTER_MS)
      return;
    tried.current = true;
    sync.mutate({});
  }, [status.data?.configured, connection, sync]);
  return { syncing: sync.isPending };
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
