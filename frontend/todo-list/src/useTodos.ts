import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";

export function useTodos() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.todo.key() });

  const todos = useQuery(orpc.todo.list.queryOptions());

  const create = useMutation(
    orpc.todo.create.mutationOptions({
      onSuccess: invalidate,
      onError: (err) => notifyError(err, "Could not add the item"),
    }),
  );
  const update = useMutation(
    orpc.todo.update.mutationOptions({
      onSuccess: invalidate,
      onError: (err) => notifyError(err, "Could not update the item"),
    }),
  );
  const remove = useMutation(
    orpc.todo.remove.mutationOptions({
      onSuccess: invalidate,
      onError: (err) => notifyError(err, "Could not delete the item"),
    }),
  );

  return { todos, create, update, remove };
}
