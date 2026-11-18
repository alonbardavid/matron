import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { AlarmSelect } from "@frontend/notifications/widgets/AlarmSelect";

/** The caller's own reminder before the item's due day ends. */
export function ItemAlarm({ itemId }: { itemId: string }) {
  const queryClient = useQueryClient();
  const input = { id: itemId };
  const alarm = useQuery(orpc.lists.itemAlarm.queryOptions({ input }));
  const set = useMutation(
    orpc.lists.setItemAlarm.mutationOptions({
      onSuccess: (saved) =>
        queryClient.setQueryData(orpc.lists.itemAlarm.queryKey({ input }), saved),
      onError: (err) => notifyError(err, "Could not set the reminder"),
    }),
  );
  return (
    <AlarmSelect
      value={alarm.data?.minutesBefore}
      onChange={(minutesBefore) => set.mutate({ id: itemId, minutesBefore })}
      disabled={set.isPending}
    />
  );
}
