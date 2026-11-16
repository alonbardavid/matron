import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import { useMe } from "@frontend/auth/useMe";
import { toDayString } from "./times";

export const VIEWS = ["day", "week", "month", "year"] as const;
export type View = (typeof VIEWS)[number];

/**
 * What the calendar shows, from the URL:
 * - `?view=`, else the view last chosen on this device, kept per member like
 *   the filters. Choosing a view puts it in the URL and keeps it as the
 *   device's; a view opened from the URL is not kept.
 * - `?date=`, else today. Moving to another day or week puts it in the URL and
 *   is never kept; back on today, the URL drops it.
 */
const VIEW_PARAM = "view";
const DATE_PARAM = "date";
const VIEW_KEY = "matron:calendar-view";

type Changes = Record<string, string | null>;

function asView(value: string | null): View | null {
  return VIEWS.find((view) => view === value) ?? null;
}

function asDay(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value).isValid()
    ? value
    : null;
}

function readView(key: string): View | null {
  try {
    return asView(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

/** The view and the date shown, `fallback` being the view before one was ever chosen. */
export function useCalendarDisplay(fallback: View) {
  const { me } = useMe();
  const key = `${VIEW_KEY}:${me?.id ?? "anyone"}`;
  const [params, setParams] = useSearchParams();
  const [stored, setStored] = useState(() => ({ key, view: readView(key) }));
  const kept = stored.key === key ? stored.view : readView(key);

  // Changes made together (a day picked from the week changes both) go in one write.
  const pending = useRef<Changes | null>(null);
  const write = useCallback(
    (changes: Changes) => {
      if (pending.current) {
        Object.assign(pending.current, changes);
        return;
      }
      pending.current = { ...changes };
      queueMicrotask(() => {
        const all = pending.current ?? {};
        pending.current = null;
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            for (const [name, value] of Object.entries(all)) {
              if (value === null) next.delete(name);
              else next.set(name, value);
            }
            return next;
          },
          { replace: true },
        );
      });
    },
    [setParams],
  );

  const setView = useCallback(
    (view: View) => {
      try {
        window.localStorage.setItem(key, view);
      } catch {
        // Storage may be full or blocked; the URL still holds the choice.
      }
      setStored({ key, view });
      write({ [VIEW_PARAM]: view });
    },
    [key, write],
  );
  const setDate = useCallback(
    (date: string) => {
      const day = toDayString(dayjs(date).valueOf());
      write({ [DATE_PARAM]: day === toDayString(Date.now()) ? null : day });
    },
    [write],
  );

  return {
    view: asView(params.get(VIEW_PARAM)) ?? kept ?? fallback,
    setView,
    date: asDay(params.get(DATE_PARAM)) ?? toDayString(Date.now()),
    setDate,
  };
}
