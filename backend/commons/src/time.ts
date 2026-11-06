/**
 * Wall clocks in a named time zone, without a date library: what a zone reads
 * at an instant, and the instant at which it reads a given time.
 */

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

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
