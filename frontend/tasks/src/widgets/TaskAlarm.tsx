import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { AlarmSelect } from "@frontend/notifications/widgets/AlarmSelect";

/** The caller's own reminder before the task's due day ends. */
export function TaskAlarm({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient();
  const input = { id: taskId };
  const alarm = useQuery(orpc.tasks.alarm.queryOptions({ input }));
  const set = useMutation(
    orpc.tasks.setAlarm.mutationOptions({
      onSuccess: (saved) =>
        queryClient.setQueryData(orpc.tasks.alarm.queryKey({ input }), saved),
      onError: (err) => notifyError(err, "Could not set the reminder"),
    }),
  );
  return (
    <AlarmSelect
      value={alarm.data?.minutesBefore}
      onChange={(minutesBefore) => set.mutate({ id: taskId, minutesBefore })}
      disabled={set.isPending}
    />
  );
}
