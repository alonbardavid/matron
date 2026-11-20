import { useMemo } from "react";
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  LIST_COLORS,
  type ItemCreate,
  type ItemUpdate,
  type List,
  type ListCreate,
  type ListItem,
  type ListUpdate,
  type SharePermission,
} from "@shared/contract/app/lists";
import { notifyError } from "@frontend/api/errors";
import { api, orpc } from "@frontend/api/orpc";
import { useMe } from "@frontend/auth/useMe";
import { applyMove, childrenOf, subtreeIds, type Placement } from "./tree";

/*
 * Local first. Every screen reads one query, every list with all its items,
 * and sees it with the changes not yet saved made on top. A change shows the
 * moment it is made; it is sent after the ones before it, held while offline;
 * a change the server refuses drops away, and with it what it showed. Once
 * none are left to send, the lists are fetched again.
 */

const allLists = () => orpc.lists.list.queryOptions({ input: {}, staleTime: 10_000 });
const CHANGE = ["lists", "change"];

interface Change {
  /** The lists with the change made. Making it twice is the same as once. */
  apply: (lists: List[]) => List[];
  send: () => Promise<unknown>;
  /** What the notice says when the server refuses it. */
  failure: string;
}

/** Every list the caller has, with its items, and the changes on their way made. */
export function useAllLists() {
  const query = useQuery(allLists());
  const pending = useMutationState({
    filters: { mutationKey: CHANGE, status: "pending" },
    select: (mutation) => (mutation.state.variables as Change).apply,
  });
  const lists = useMemo(
    () => query.data && pending.reduce((acc, apply) => apply(acc), query.data),
    [query.data, pending],
  );
  return { lists, isLoading: query.isLoading };
}

/** One list, from the same lists as the rest. */
export function useList(id: string) {
  const { lists, isLoading } = useAllLists();
  return { list: lists?.find((list) => list.id === id), isLoading };
}

/** An item with a due day, as the calendar shows it. */
export interface DueItem extends ListItem {
  listName: string;
  listColor: string;
  /** Who sees its list, and so may be assigned it. */
  people: string[];
  /** Whether the caller may change it. */
  editable: boolean;
}

/** Every item with a due day on the caller's lists, for the calendar. */
export function useDueItems(): DueItem[] {
  const { lists } = useAllLists();
  return useMemo(
    () =>
      (lists ?? []).flatMap((list) =>
        list.items
          .filter((item) => item.dueDate !== null)
          .map((item) => ({
            ...item,
            listName: list.name,
            listColor: list.color,
            people: [list.creatorId, ...list.sharedWith],
            editable: list.myPermissions.includes("edit"),
          })),
      ),
    [lists],
  );
}

/** Sends changes one after another, and shows each until the lists are fetched again. */
function useChange() {
  const queryClient = useQueryClient();
  const { mutate } = useMutation({
    mutationKey: CHANGE,
    scope: { id: "lists" },
    mutationFn: (change: Change) => change.send(),
    onSuccess: async (_answer, change) => {
      // A fetch begun before the server had this change would undo it on screen.
      await queryClient.cancelQueries({
        queryKey: allLists().queryKey,
        predicate: (query) => query.state.data !== undefined,
      });
      queryClient.setQueryData<List[]>(
        allLists().queryKey,
        (old) => old && change.apply(old),
      );
    },
    onError: (err, change) => notifyError(err, change.failure),
    // This change still counts until it is settled: one means it was the last.
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: CHANGE }) === 1) {
        return queryClient.invalidateQueries({ queryKey: orpc.lists.key() });
      }
    },
  });
  return mutate;
}

const EVERYTHING: SharePermission[] = ["view", "share", "edit"];

/** The list with `id` changed by `change`, the rest as they were. */
function onList(lists: List[], id: string, change: (list: List) => List): List[] {
  return lists.map((list) => (list.id === id ? change(list) : list));
}

/** The list holding the item with `id` changed by `change`; it is the last changed now. */
function onItemsOf(
  lists: List[],
  id: string,
  now: number,
  change: (items: ListItem[]) => ListItem[],
): List[] {
  return lists.map((list) =>
    list.items.some((item) => item.id === id)
      ? { ...list, items: change(list.items), updatedAt: Math.max(list.updatedAt, now) }
      : list,
  );
}

/** Make, change and remove lists. Each shows at once; `create` gives the new list's id. */
export function useListActions() {
  const change = useChange();
  const { me } = useMe();
  return {
    create: (values: ListCreate): string => {
      const id = `LI_${crypto.randomUUID()}`;
      const now = Date.now();
      const made: List = {
        id,
        name: values.name,
        color: values.color ?? LIST_COLORS[0],
        creatorId: me?.id ?? "",
        sharedWith: values.sharedWith ?? [],
        permissions: values.permissions ?? {},
        myPermissions: EVERYTHING,
        createdAt: now,
        updatedAt: now,
        items: [],
      };
      change({
        apply: (lists) => (lists.some((list) => list.id === id) ? lists : [made, ...lists]),
        send: () => api.lists.create({ id, ...values }),
        failure: "Could not make the list",
      });
      return id;
    },
    update: (id: string, values: ListUpdate) => {
      const now = Date.now();
      change({
        apply: (lists) =>
          onList(lists, id, (list) => ({
            ...list,
            ...values,
            updatedAt: Math.max(list.updatedAt, now),
          })),
        send: () => api.lists.update({ id, ...values }),
        failure: "Could not save the list",
      });
    },
    remove: (id: string) =>
      change({
        apply: (lists) => lists.filter((list) => list.id !== id),
        send: () => api.lists.remove({ id }),
        failure: "Could not remove the list",
      }),
  };
}

/** Add, change, tick off, move and remove items. Each shows at once. */
export function useItemActions() {
  const change = useChange();
  const { me } = useMe();
  return {
    add: (listId: string, values: ItemCreate) => {
      const itemId = `LT_${crypto.randomUUID()}`;
      const now = Date.now();
      const parentId = values.parentId ?? null;
      change({
        apply: (lists) =>
          onList(lists, listId, (list) => {
            if (list.items.some((item) => item.id === itemId)) return list;
            const siblings = list.items.filter((item) => item.parentId === parentId);
            const added: ListItem = {
              id: itemId,
              listId,
              parentId,
              position: Math.max(-1, ...siblings.map((item) => item.position)) + 1,
              title: values.title,
              description: values.description ?? "",
              creatorId: me?.id ?? "",
              dueDate: values.dueDate ?? null,
              completedAt: null,
              assignees: values.assignees ?? [],
              createdAt: now,
              updatedAt: now,
            };
            return { ...list, items: [...list.items, added], updatedAt: now };
          }),
        send: () => api.lists.addItem({ id: listId, itemId, ...values }),
        failure: "Could not add the item",
      });
    },
    update: (id: string, values: ItemUpdate) => {
      const now = Date.now();
      const { completed, ...fields } = values;
      change({
        apply: (lists) =>
          onItemsOf(lists, id, now, (items) =>
            items.map((item) =>
              item.id === id
                ? {
                    ...item,
                    ...fields,
                    ...(completed !== undefined && {
                      completedAt: completed ? (item.completedAt ?? now) : null,
                    }),
                  }
                : item,
            ),
          ),
        send: () => api.lists.updateItem({ id, ...values }),
        failure: completed === undefined ? "Could not change the item" : "Could not tick it",
      });
    },
    move: (id: string, placement: Placement) => {
      const now = Date.now();
      change({
        apply: (lists) => onItemsOf(lists, id, now, (items) => applyMove(items, id, placement)),
        send: () => api.lists.moveItem({ id, ...placement }),
        failure: "Could not move the item",
      });
    },
    remove: (id: string) => {
      const now = Date.now();
      change({
        apply: (lists) =>
          onItemsOf(lists, id, now, (items) => {
            const gone = subtreeIds(childrenOf(items), id);
            return items.filter((item) => !gone.has(item.id));
          }),
        send: () => api.lists.removeItem({ id }),
        failure: "Could not remove the item",
      });
    },
  };
}
