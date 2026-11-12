import { useCallback, useEffect, useState } from "react";
import { useMe } from "@frontend/auth/useMe";

/**
 * What the calendar shows, chosen on each device: kept in this browser's
 * storage, per member, so a shared tablet keeps each member's own choice.
 */
export interface CalendarFilters {
  /** Calendars left out; any calendar not named here shows, a new one included. */
  hiddenCalendars: string[];
  /** When any are named, only events carrying one of these labels show. */
  labels: string[];
  /** Tasks with a due date, as all-day items on that day. */
  showTasks: boolean;
  /** Events the member hid, shown faded so they can be opened and unhidden. */
  showHidden: boolean;
}

export const DEFAULT_FILTERS: CalendarFilters = {
  hiddenCalendars: [],
  labels: [],
  showTasks: true,
  showHidden: false,
};

const KEY = "matron:calendar-filters";

function read(key: string): CalendarFilters {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<CalendarFilters>;
    const ids = (value: unknown) =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    return {
      hiddenCalendars: ids(parsed.hiddenCalendars),
      labels: ids(parsed.labels),
      showTasks:
        typeof parsed.showTasks === "boolean"
          ? parsed.showTasks
          : DEFAULT_FILTERS.showTasks,
      showHidden:
        typeof parsed.showHidden === "boolean"
          ? parsed.showHidden
          : DEFAULT_FILTERS.showHidden,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** Whether anything is filtered out, for the filters button to say so. */
export function filtering(filters: CalendarFilters): boolean {
  return (
    filters.hiddenCalendars.length > 0 ||
    filters.labels.length > 0 ||
    filters.showTasks !== DEFAULT_FILTERS.showTasks ||
    filters.showHidden !== DEFAULT_FILTERS.showHidden
  );
}

/** The member's filters on this device, and a setter that keeps them there. */
export function useCalendarFilters() {
  const { me } = useMe();
  const key = `${KEY}:${me?.id ?? "anyone"}`;
  const [filters, setFilters] = useState<CalendarFilters>(() => read(key));
  useEffect(() => setFilters(read(key)), [key]);
  const update = useCallback(
    (changes: Partial<CalendarFilters>) => {
      setFilters((prev) => {
        const next = { ...prev, ...changes };
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Storage may be full or blocked; the choice still holds until reload.
        }
        return next;
      });
    },
    [key],
  );
  const reset = useCallback(() => update(DEFAULT_FILTERS), [update]);
  return { filters, update, reset };
}
