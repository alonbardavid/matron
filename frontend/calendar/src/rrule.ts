import dayjs from "dayjs";
import { RRule } from "rrule";

/**
 * The repeat editor's form of an iCalendar RRULE. It covers what the editor
 * offers; a rule with more (BYSETPOS, BYMONTH lists, several nth weekdays)
 * stays as `custom` text, shown in words and kept unless replaced.
 */
export interface RepeatDraft {
  freq: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  /** Weekly: weekdays, 0 Sunday to 6 Saturday. */
  weekdays: number[];
  /** Monthly: on days of the month, or on the nth weekday. */
  monthMode: "day" | "weekday";
  /** Days of the month; -1 is the last day. */
  monthDays: number[];
  /** 1 to 4, or -1 for the last. */
  nth: number;
  nthWeekday: number;
  ends: "never" | "on" | "after";
  /** The last day it may occur on, `YYYY-MM-DD`. */
  until: string | null;
  count: number;
  /** A rule the editor cannot show field by field, kept as is. */
  custom: string | null;
}

const ICAL_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const UNTIL = /(?:^|;)UNTIL=(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/i;

/** The draft for a start, before any rule: repeating on the start's own weekday or day. */
export function defaultDraft(startAt: number): RepeatDraft {
  const start = dayjs(startAt);
  const nth = Math.ceil(start.date() / 7);
  return {
    freq: "NONE",
    interval: 1,
    weekdays: [start.day()],
    monthMode: "day",
    monthDays: [start.date()],
    nth: nth > 4 ? -1 : nth,
    nthWeekday: start.day(),
    ends: "never",
    until: null,
    count: 10,
    custom: null,
  };
}

/** A stored rule as the editor's draft; anything it cannot show becomes `custom`. */
export function parseRule(rule: string | null, startAt: number): RepeatDraft {
  const draft = defaultDraft(startAt);
  if (!rule) return draft;
  const text = rule.replace(/^RRULE:/i, "").toUpperCase();
  const parts = new Map(
    text.split(";").map((part) => part.split("=") as [string, string | undefined]),
  );
  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") {
    return { ...draft, freq: "WEEKLY", custom: text };
  }
  const known = new Set([
    "FREQ",
    "INTERVAL",
    "BYDAY",
    "BYMONTHDAY",
    "UNTIL",
    "COUNT",
    "WKST",
  ]);
  const custom = [...parts.keys()].some((key) => !known.has(key));
  const out: RepeatDraft = {
    ...draft,
    freq,
    interval: Number(parts.get("INTERVAL") ?? 1) || 1,
  };
  const byday = parts.get("BYDAY")?.split(",") ?? [];
  const nthDays = byday.map((d) => /^([+-]?\d)?([A-Z]{2})$/.exec(d));
  if (byday.length && nthDays.some((m) => !m)) return { ...out, custom: text };
  if (freq === "WEEKLY" && byday.length) {
    if (nthDays.some((m) => m![1])) return { ...out, custom: text };
    out.weekdays = nthDays.map((m) => ICAL_DAYS.indexOf(m![2]!)).sort((a, b) => a - b);
  }
  if (freq === "MONTHLY") {
    const monthDays = parts.get("BYMONTHDAY");
    if (byday.length === 1 && nthDays[0]![1]) {
      out.monthMode = "weekday";
      out.nth = Number(nthDays[0]![1]);
      out.nthWeekday = ICAL_DAYS.indexOf(nthDays[0]![2]!);
    } else if (byday.length) {
      return { ...out, custom: text };
    } else if (monthDays) {
      out.monthDays = monthDays.split(",").map(Number);
    }
  }
  if (
    (freq === "DAILY" || freq === "YEARLY") &&
    (byday.length || parts.has("BYMONTHDAY"))
  ) {
    return { ...out, custom: text };
  }
  const until = UNTIL.exec(text);
  if (until) {
    const [, y, m, d, hh, mm, ss, z] = until;
    out.ends = "on";
    // A UTC instant is the day it falls on here; a day is that day.
    out.until = hh
      ? dayjs(
          z
            ? Date.UTC(+y!, +m! - 1, +d!, +hh, +mm!, +ss!)
            : new Date(+y!, +m! - 1, +d!, +hh, +mm!, +ss!),
        ).format("YYYY-MM-DD")
      : `${y}-${m}-${d}`;
  } else if (parts.has("COUNT")) {
    out.ends = "after";
    out.count = Number(parts.get("COUNT")) || 1;
  }
  return custom ? { ...out, custom: text } : out;
}

/** The draft as an RRULE value, or null for a single event. UNTIL goes as a day; the server stores it as the standard wants. */
export function buildRule(draft: RepeatDraft): string | null {
  if (draft.freq === "NONE") return null;
  if (draft.custom) return draft.custom;
  const parts = [`FREQ=${draft.freq}`];
  if (draft.interval > 1) parts.push(`INTERVAL=${draft.interval}`);
  if (draft.freq === "WEEKLY" && draft.weekdays.length) {
    parts.push(`BYDAY=${draft.weekdays.map((d) => ICAL_DAYS[d]).join(",")}`);
  }
  if (draft.freq === "MONTHLY") {
    if (draft.monthMode === "weekday") {
      parts.push(`BYDAY=${draft.nth}${ICAL_DAYS[draft.nthWeekday]}`);
    } else if (draft.monthDays.length) {
      parts.push(`BYMONTHDAY=${draft.monthDays.join(",")}`);
    }
  }
  if (draft.ends === "on" && draft.until)
    parts.push(`UNTIL=${draft.until.replace(/-/g, "")}`);
  if (draft.ends === "after") parts.push(`COUNT=${Math.max(1, draft.count)}`);
  return parts.join(";");
}

/** The rule in words: "every 2 weeks on Tuesday, Thursday". */
export function describeRule(rule: string | null): string {
  if (!rule) return "Does not repeat";
  try {
    const text = RRule.fromString(`RRULE:${rule.replace(/^RRULE:/i, "")}`).toText();
    return text.charAt(0).toUpperCase() + text.slice(1);
  } catch {
    return rule;
  }
}
