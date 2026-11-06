import { dayKey, fromWallClock, wallClock } from "@backend/commons/time";
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

const DAY_MS = 86_400_000;
/** Beyond this many days from the series start, no occurrence is generated. */
const HORIZON_DAYS = 366 * 5;

export interface OccurrenceWindow {
  startAt: number;
  endAt: number;
  /** The occurrence's calendar day in the series' zone, `YYYY-MM-DD`. */
  day: string;
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
