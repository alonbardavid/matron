import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { SortingState } from "@tanstack/react-table";

/**
 * The page's state lives in its URL, so a view can be bookmarked: `tab`, and
 * for the tab shown `page`, `sort` (`-startedAt` is descending) and its
 * filters. A value equal to its default is left out of the URL.
 */
const TAB_PARAM = "tab";
const PAGE_PARAM = "page";
const SORT_PARAM = "sort";
/** The parameters that describe one tab's view, dropped when the tab changes. */
const VIEW_PARAMS = [PAGE_PARAM, SORT_PARAM, "stopped", "archived"];

type Changes = Record<string, string | null>;

/** The URL's parameters, and one call that changes several at once. */
export function useUrlParams() {
  const [params, setParams] = useSearchParams();
  const update = useCallback(
    (changes: Changes, options: { push?: boolean } = {}) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: !options.push },
      );
    },
    [setParams],
  );
  return { params, update };
}

export function useTab(fallback: string): [string, (tab: string) => void] {
  const { params, update } = useUrlParams();
  const tab = params.get(TAB_PARAM) ?? fallback;
  const set = useCallback(
    (next: string) => {
      const changes: Changes = Object.fromEntries(VIEW_PARAMS.map((key) => [key, null]));
      changes[TAB_PARAM] = next === fallback ? null : next;
      update(changes, { push: true });
    },
    [fallback, update],
  );
  return [tab, set];
}

/** One filter of the tab shown, as a URL parameter. */
export function useFilterParam(
  key: string,
  fallback: string,
): [string, (value: string) => void] {
  const { params, update } = useUrlParams();
  const value = params.get(key) ?? fallback;
  const set = useCallback(
    (next: string) =>
      update({ [key]: next === fallback ? null : next, [PAGE_PARAM]: null }),
    [key, fallback, update],
  );
  return [value, set];
}

/** The table's page and sort, as URL parameters; a new sort starts from the first page. */
export function useTableView(defaultSort: SortingState) {
  const { params, update } = useUrlParams();
  const page = Math.max(1, Number.parseInt(params.get(PAGE_PARAM) ?? "1", 10) || 1);
  const sorting = decodeSort(params.get(SORT_PARAM)) ?? defaultSort;
  return {
    page,
    onPageChange: (next: number) =>
      update({ [PAGE_PARAM]: next <= 1 ? null : String(next) }),
    sorting,
    onSortingChange: (next: SortingState) => {
      const encoded = encodeSort(next);
      update({
        [SORT_PARAM]: encoded === encodeSort(defaultSort) ? null : encoded,
        [PAGE_PARAM]: null,
      });
    },
  };
}

function encodeSort(sorting: SortingState): string | null {
  const first = sorting[0];
  return first ? `${first.desc ? "-" : ""}${first.id}` : null;
}

function decodeSort(text: string | null): SortingState | null {
  if (!text) return null;
  return text.startsWith("-")
    ? [{ id: text.slice(1), desc: true }]
    : [{ id: text, desc: false }];
}
