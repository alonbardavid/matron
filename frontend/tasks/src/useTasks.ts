import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";

export function useTasks() {
  return useQuery(orpc.tasks.list.queryOptions({ staleTime: 10_000 }));
}

/** Create, update and remove, each refreshing the list. */
export function useTaskActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.tasks.key() });
  const create = useMutation(orpc.tasks.create.mutationOptions({ onSuccess: refresh }));
  const update = useMutation(
    orpc.tasks.update.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not update the task"),
    }),
  );
  const remove = useMutation(
    orpc.tasks.remove.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not remove the task"),
    }),
  );
  return { create, update, remove };
}
