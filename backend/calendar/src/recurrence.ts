import { RRule, type Options } from "rrule";
import { dayKey, fromWallClock, wallClock } from "@backend/commons/time";

/**
 * Repeating events as the iCalendar standard has them (RFC 5545): a series is
 * its first occurrence (DTSTART: the event's start, in its own time zone) and
 * an RRULE, such as `FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH` or
 * `FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20271231T225959Z`. Single occurrences are
 * cancelled or changed by exceptions, keyed by the instant they were due.
 *
 * The rrule library does the rule arithmetic in "floating" time: wall-clock
 * dates written as if they were UTC. This module turns the event's start into
 * floating time in its zone, expands, and turns each result back into the
 * instant that zone reads it, so a weekly 09:00 stays 09:00 across
 * daylight-saving changes.
 */

export interface SeriesInput {
  startAt: number;
  endAt: number;
  timeZone: string;
  /** The RRULE value, without the `RRULE:` prefix. */
  rule: string;
}

/** A cancelled or changed occurrence, keyed by the instant it was due. */
export interface ExceptionInput {
  originalStartAt: number;
  cancelled: boolean;
  startAt: number | null;
  endAt: number | null;
}

export interface OccurrenceWindow {
  startAt: number;
  endAt: number;
  /** When the series had it due; the key of its exception. */
  originalStartAt: number;
  /** The occurrence's calendar day in the series' zone, `YYYY-MM-DD`. */
  day: string;
  /** Whether an exception changed it. */
  changed: boolean;
}

const DAY_MS = 86_400_000;
/** Frequencies Matron expands; finer ones would make a series of thousands a day. */
const FREQUENCIES = new Set([RRule.YEARLY, RRule.MONTHLY, RRule.WEEKLY, RRule.DAILY]);
const UNTIL_PATTERN =
  /(^|;)UNTIL=(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?(?=;|$)/i;

/** Why a rule cannot be used, for the caller to show. */
export class InvalidRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRuleError";
  }
}

/** The rule's text with any `RRULE:` prefix gone and the names upper-cased. */
function bare(rule: string): string {
  return rule
    .trim()
    .replace(/^RRULE:/i, "")
    .toUpperCase();
}

/** Parses and checks a rule; throws InvalidRuleError. */
function parse(rule: string): Partial<Options> {
  const text = bare(rule);
  if (/DTSTART|TZID|\n/.test(text)) {
    throw new InvalidRuleError(
      "A repeat rule holds only RRULE parts; the start is the event's",
    );
  }
  let options: Partial<Options>;
  try {
    options = RRule.parseString(text);
  } catch {
    throw new InvalidRuleError(`Not an iCalendar repeat rule: ${text}`);
  }
  if (options.freq === undefined || !FREQUENCIES.has(options.freq)) {
    throw new InvalidRuleError("A repeat rule repeats daily, weekly, monthly or yearly");
  }
  if (options.until && options.count) {
    throw new InvalidRuleError("A repeat rule ends on a day or after a count, not both");
  }
  return options;
}

/**
 * The rule as stored: checked, without the prefix, and with UNTIL in the form
 * the standard wants for the event. A day (`UNTIL=20271231`) on a timed event
 * becomes the UTC instant that day ends in the event's zone; an all-day event
 * keeps a day.
 */
export function canonicalRule(rule: string, timeZone: string, allDay: boolean): string {
  parse(rule);
  const text = bare(rule);
  const until = UNTIL_PATTERN.exec(text);
  if (!until) return text;
  const [, , y, m, d, hh, mm, ss, z] = until;
  let value: string;
  if (allDay) {
    // A timed UNTIL on an all-day series: the day it falls on in the zone.
    const clock =
      hh && z ? wallClock(Date.UTC(+y!, +m! - 1, +d!, +hh, +mm!, +ss!), timeZone) : null;
    value = clock ? compactDay(clock) : `${y}${m}${d}`;
  } else if (!hh) {
    value = utcStamp(
      fromWallClock(
        { year: +y!, month: +m!, day: +d!, hour: 23, minute: 59, second: 59 },
        timeZone,
      ),
    );
  } else if (!z) {
    value = utcStamp(
      fromWallClock(
        { year: +y!, month: +m!, day: +d!, hour: +hh, minute: +mm!, second: +ss! },
        timeZone,
      ),
    );
  } else {
    return text;
  }
  return text.replace(UNTIL_PATTERN, `$1UNTIL=${value}`);
}

/** The rule ending on `lastDay` (`YYYY-MM-DD`): its COUNT and UNTIL replaced by that day's end. */
export function ruleEndingOn(
  rule: string,
  lastDay: string,
  timeZone: string,
  allDay: boolean,
): string {
  const parts = bare(rule)
    .split(";")
    .filter((part) => part && !/^(UNTIL|COUNT)=/.test(part));
  parts.push(`UNTIL=${lastDay.replace(/-/g, "")}`);
  return canonicalRule(parts.join(";"), timeZone, allDay);
}

/** Whether a stored rule is still one Matron can expand; a bad one expands to its first occurrence only. */
export function isValidRule(rule: string): boolean {
  try {
    parse(rule);
    return true;
  } catch {
    return false;
  }
}

/**
 * The occurrences of a series that overlap [from, to), exceptions applied: a
 * cancelled one is left out, a changed one moves, even into the window from
 * outside it. The first occurrence is always the event's own start, as the
 * standard has it.
 */
export function expandSeries(
  series: SeriesInput,
  exceptions: readonly ExceptionInput[],
  from: number,
  to: number,
): OccurrenceWindow[] {
  const { startAt, endAt, timeZone } = series;
  const duration = Math.max(0, endAt - startAt);
  const byOriginal = new Map(exceptions.map((e) => [e.originalStartAt, e]));
  const out: OccurrenceWindow[] = [];
  const seen = new Set<number>();
  const push = (originalStartAt: number) => {
    if (seen.has(originalStartAt)) return;
    seen.add(originalStartAt);
    const exception = byOriginal.get(originalStartAt);
    if (exception?.cancelled) return;
    const start = exception?.startAt ?? originalStartAt;
    const end = exception?.endAt ?? start + duration;
    if (start < to && end > from) {
      out.push({
        startAt: start,
        endAt: end,
        originalStartAt,
        day: dayKey(wallClock(originalStartAt, timeZone)),
        changed: exception !== undefined,
      });
    }
  };

  const rule = ruleFor(series);
  if (!rule) {
    push(startAt);
    return out;
  }
  // Widened by the duration and a day each side, as floating time differs from
  // the instant by the zone's offset; exact overlap is checked in push().
  const lo = new Date(floating(from, timeZone) - duration - DAY_MS);
  const hi = new Date(floating(to, timeZone) + DAY_MS);
  if (startAt < to && startAt + duration > from) push(startAt);
  for (const date of rule.between(lo, hi, true)) push(fromFloating(date, timeZone));
  // Changed occurrences moved here from outside the window.
  for (const exception of exceptions) {
    if (exception.cancelled || seen.has(exception.originalStartAt)) continue;
    const start = exception.startAt ?? exception.originalStartAt;
    if (start >= to || (exception.endAt ?? start + duration) <= from) continue;
    if (isOccurrence(series, exception.originalStartAt)) push(exception.originalStartAt);
  }
  return out.sort((a, b) => a.startAt - b.startAt);
}

/** Whether the series has an occurrence due at `instant`. */
export function isOccurrence(series: SeriesInput, instant: number): boolean {
  if (instant === series.startAt) return true;
  const rule = ruleFor(series);
  if (!rule) return false;
  const at = floating(instant, series.timeZone);
  return rule.between(new Date(at - 1000), new Date(at + 1000), true).length > 0;
}

/**
 * The rule with its start in floating time. The first occurrence counts toward
 * COUNT even when it does not match the rule, as the standard has it.
 */
function ruleFor(series: SeriesInput): RRule | null {
  let options: Partial<Options>;
  try {
    options = parse(series.rule);
  } catch {
    return null;
  }
  const dtstart = new Date(floating(series.startAt, series.timeZone));
  const until = floatingUntil(series.rule, series.timeZone);
  const rule = new RRule({ ...options, dtstart, until, tzid: null });
  if (options.count) {
    const first = rule.after(new Date(dtstart.getTime() - 1000), true);
    if (first?.getTime() !== dtstart.getTime()) {
      if (options.count <= 1) return null;
      return new RRule({
        ...options,
        dtstart,
        until,
        tzid: null,
        count: options.count - 1,
      });
    }
  }
  return rule;
}

/** UNTIL in floating time: a day ends at its last second; a UTC instant reads in the zone. */
function floatingUntil(rule: string, timeZone: string): Date | null {
  const match = UNTIL_PATTERN.exec(bare(rule));
  if (!match) return null;
  const [, , y, m, d, hh, mm, ss, z] = match;
  if (!hh) return new Date(Date.UTC(+y!, +m! - 1, +d!, 23, 59, 59));
  const stamp = Date.UTC(+y!, +m! - 1, +d!, +hh, +mm!, +ss!);
  return new Date(z ? floating(stamp, timeZone) : stamp);
}

/** The instant's wall clock in the zone, written as if it were UTC. */
function floating(ms: number, timeZone: string): number {
  const c = wallClock(ms, timeZone);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
}

function fromFloating(date: Date, timeZone: string): number {
  return fromWallClock(
    {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    },
    timeZone,
  );
}

function utcStamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function compactDay(clock: { year: number; month: number; day: number }): string {
  return dayKey(clock).replace(/-/g, "");
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
