import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";

/** The caller's lists as cards; `q` keeps those whose name or items match. */
export function useLists(q: string) {
  return useQuery(
    orpc.lists.list.queryOptions({
      input: { q: q.trim() || undefined },
      staleTime: 10_000,
      placeholderData: (previous) => previous,
    }),
  );
}

/** One list with all its items. */
export function useList(id: string) {
  return useQuery(orpc.lists.get.queryOptions({ input: { id }, staleTime: 5_000 }));
}

/** Every item with a due day on the caller's lists, for the calendar. */
export function useDueItems(enabled = true) {
  return useQuery(orpc.lists.dueItems.queryOptions({ staleTime: 10_000, enabled }));
}

/** Every change refreshes all the lists' queries: cards, list pages and the calendar's items. */
function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: orpc.lists.key() });
}

/** Make, change and remove lists. */
export function useListActions() {
  const refresh = useRefresh();
  const create = useMutation(orpc.lists.create.mutationOptions({ onSuccess: refresh }));
  const update = useMutation(orpc.lists.update.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(
    orpc.lists.remove.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not remove the list"),
    }),
  );
  return { create, update, remove };
}

/** Add, change, move and remove items. */
export function useItemActions() {
  const refresh = useRefresh();
  const add = useMutation(
    orpc.lists.addItem.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not add the item"),
    }),
  );
  const update = useMutation(
    orpc.lists.updateItem.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not change the item"),
    }),
  );
  const move = useMutation(
    orpc.lists.moveItem.mutationOptions({
      onSettled: refresh,
      onError: (err) => notifyError(err, "Could not move the item"),
    }),
  );
  const remove = useMutation(
    orpc.lists.removeItem.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not remove the item"),
    }),
  );
  return { add, update, move, remove };
}
