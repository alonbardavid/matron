import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { AlarmSelect } from "@frontend/notifications/widgets/AlarmSelect";

/** The caller's own reminder before the event starts, every occurrence of it. */
export function EventAlarm({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const input = { id: eventId };
  const alarm = useQuery(orpc.calendar.alarm.queryOptions({ input }));
  const set = useMutation(
    orpc.calendar.setAlarm.mutationOptions({
      onSuccess: (saved) =>
        queryClient.setQueryData(orpc.calendar.alarm.queryKey({ input }), saved),
      onError: (err) => notifyError(err, "Could not set the reminder"),
    }),
  );
  return (
    <AlarmSelect
      value={alarm.data?.minutesBefore}
      onChange={(minutesBefore) => set.mutate({ id: eventId, minutesBefore })}
      disabled={set.isPending}
    />
  );
}
