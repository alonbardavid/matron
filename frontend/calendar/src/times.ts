import { TZDate } from "@date-fns/tz";
import {
  addDays,
  addWeeks,
  endOfDay,
  endOfWeek,
  format,
  parseISO,
  startOfWeek,
  subWeeks,
} from "date-fns";

/** The browser's zone, which every event made here is reckoned in. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Mantine's `YYYY-MM-DD HH:mm:ss`, in local time. */
export function toDateTimeString(ms: number): string {
  return format(ms, "yyyy-MM-dd HH:mm:ss");
}

export function toDayString(ms: number): string {
  return format(ms, "yyyy-MM-dd");
}

export function fromDateTimeString(value: string): number {
  return parseISO(value).getTime();
}

/** The day an instant falls on in a zone, as `YYYY-MM-DD`. */
function dayIn(ms: number, timeZone: string): string {
  try {
    return format(new TZDate(ms, timeZone), "yyyy-MM-dd");
  } catch {
    return toDayString(ms);
  }
}

/**
 * An all-day event as the calendar draws it: from local midnight of its first
 * day to local midnight after its last. The days are the ones it covers in its
 * own zone, so it sits on the same dates wherever it is looked at, and the
 * span is whole days exactly, which is what puts it in the all-day row.
 */
export function allDayBlock(
  startAt: number,
  endAt: number,
  timeZone: string,
): { start: Date; end: Date } {
  const first = dayIn(startAt, timeZone);
  // The end is the last day's final instant, or the midnight after it.
  const last = dayIn(Math.max(startAt, endAt - 1), timeZone);
  return {
    start: parseISO(first),
    end: addDays(parseISO(last), 1),
  };
}

/** An all-day span over whole local days, from the start of `fromDay` to the end of `toDay`. */
export function allDaySpan(
  fromDay: string,
  toDay: string,
): { startAt: number; endAt: number } {
  return {
    startAt: parseISO(fromDay).getTime(),
    endAt: endOfDay(parseISO(toDay)).getTime(),
  };
}

/** The window of occurrences worth loading around a visible date: six weeks either side. */
export function loadWindow(date: string): { from: number; to: number } {
  const center = parseISO(date);
  return {
    from: startOfWeek(subWeeks(center, 6)).getTime(),
    to: endOfWeek(addWeeks(center, 6)).getTime(),
  };
}
