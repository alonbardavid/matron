import dayjs from "dayjs";

/** The browser's zone, which every event made here is reckoned in. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Mantine's `YYYY-MM-DD HH:mm:ss`, in local time. */
export function toDateTimeString(ms: number): string {
  return dayjs(ms).format("YYYY-MM-DD HH:mm:ss");
}

export function toDayString(ms: number): string {
  return dayjs(ms).format("YYYY-MM-DD");
}

export function fromDateTimeString(value: string): number {
  return dayjs(value).valueOf();
}

/** The day an instant falls on in a zone, as `YYYY-MM-DD`. */
function dayIn(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(ms);
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
    start: dayjs(first).startOf("day").toDate(),
    end: dayjs(last).add(1, "day").startOf("day").toDate(),
  };
}

/** An all-day span over whole local days, from the start of `fromDay` to the end of `toDay`. */
export function allDaySpan(
  fromDay: string,
  toDay: string,
): { startAt: number; endAt: number } {
  return {
    startAt: dayjs(fromDay).startOf("day").valueOf(),
    endAt: dayjs(toDay).endOf("day").valueOf(),
  };
}

/** The window of occurrences worth loading around a visible date: six weeks either side. */
export function loadWindow(date: string): { from: number; to: number } {
  const center = dayjs(date);
  return {
    from: center.subtract(6, "week").startOf("week").valueOf(),
    to: center.add(6, "week").endOf("week").valueOf(),
  };
}
