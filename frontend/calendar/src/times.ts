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

/**
 * Where the schedule should see an all-day span end: the midnight after its
 * last day. A span made here ends a millisecond before (`allDaySpan`), which
 * the schedule would draw as a timed block filling the day.
 */
export function allDayEnd(endAt: number): number {
  return dayjs(endAt - 1)
    .add(1, "day")
    .startOf("day")
    .valueOf();
}

/** The window of occurrences worth loading around a visible date: six weeks either side. */
export function loadWindow(date: string): { from: number; to: number } {
  const center = dayjs(date);
  return {
    from: center.subtract(6, "week").startOf("week").valueOf(),
    to: center.add(6, "week").endOf("week").valueOf(),
  };
}
