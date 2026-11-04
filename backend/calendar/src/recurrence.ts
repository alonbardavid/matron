import type { Recurrence } from "@shared/contract/app/calendar";

/**
 * Expanding a series into occurrences, in the event's own time zone: a weekly
 * event lands on the same wall-clock time on each chosen weekday, a monthly
 * one on each chosen day of the month, across daylight-saving changes.
 */

export interface SeriesInput {
  startAt: number;
  endAt: number;
  timeZone: string;
  recurrence: Recurrence;
}

export interface OccurrenceWindow {
  startAt: number;
  endAt: number;
  /** The occurrence's calendar day in the series' zone, `YYYY-MM-DD`. */
  day: string;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const DAY_MS = 86_400_000;
/** Beyond this many days from the series start, no occurrence is generated. */
const HORIZON_DAYS = 366 * 5;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The wall clock in `timeZone` at the instant `ms`. */
export function wallClock(ms: number, timeZone: string): WallClock {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday ?? ""),
  };
}

/** The instant at which `timeZone` reads the given wall clock; a skipped hour rolls forward. */
export function fromWallClock(
  clock: Omit<WallClock, "weekday">,
  timeZone: string,
): number {
  const asUtc = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  // The zone's offset at roughly that instant, refined once more.
  let guess = asUtc - offsetAt(asUtc, timeZone);
  guess = asUtc - offsetAt(guess, timeZone);
  return guess;
}

function offsetAt(ms: number, timeZone: string): number {
  const c = wallClock(ms, timeZone);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - ms;
}

export function dayKey(clock: { year: number; month: number; day: number }): string {
  return `${clock.year}-${String(clock.month).padStart(2, "0")}-${String(clock.day).padStart(2, "0")}`;
}

/**
 * The occurrences of a series that overlap [from, to). The series' own start
 * is always its first occurrence; later ones fall on the chosen days, until
 * the recurrence's end day or count.
 */
export function expandSeries(
  series: SeriesInput,
  from: number,
  to: number,
): OccurrenceWindow[] {
  const { startAt, endAt, timeZone, recurrence } = series;
  const duration = Math.max(0, endAt - startAt);
  const first = wallClock(startAt, timeZone);
  const out: OccurrenceWindow[] = [];
  let count = 0;
  const limit = recurrence.count ?? Infinity;
  const untilDay = recurrence.until;
  const days = new Set(recurrence.days);

  // Walk day by day in the series' zone, from the start day.
  let cursor = startAt;
  for (let i = 0; i < HORIZON_DAYS && count < limit; i++) {
    const clock = wallClock(cursor, timeZone);
    const key = dayKey(clock);
    if (untilDay && key > untilDay) break;
    const matches =
      i === 0 ||
      (recurrence.frequency === "weekly" ? days.has(clock.weekday) : days.has(clock.day));
    if (matches) {
      count += 1;
      const occurrenceStart =
        i === 0
          ? startAt
          : fromWallClock(
              {
                year: clock.year,
                month: clock.month,
                day: clock.day,
                hour: first.hour,
                minute: first.minute,
                second: first.second,
              },
              timeZone,
            );
      const occurrenceEnd = occurrenceStart + duration;
      if (occurrenceStart >= to) break;
      if (occurrenceEnd > from)
        out.push({ startAt: occurrenceStart, endAt: occurrenceEnd, day: key });
    }
    // Noon of the next day, so a daylight-saving change cannot skip or repeat a day.
    const noon = fromWallClock(
      {
        year: clock.year,
        month: clock.month,
        day: clock.day,
        hour: 12,
        minute: 0,
        second: 0,
      },
      timeZone,
    );
    cursor = noon + DAY_MS;
  }
  return out;
}

/** The day before `day` (`YYYY-MM-DD`), as the last day a stopped series may still occur on. */
export function dayBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!) - DAY_MS);
  return dayKey({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}
