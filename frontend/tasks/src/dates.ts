import { differenceInCalendarDays, format, isSameYear, parseISO } from "date-fns";

/** Today as a calendar day, `YYYY-MM-DD`. */
export function today(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/** "Today", "Tomorrow", "Yesterday", or a short date. */
export function describeDay(day: string): string {
  const date = parseISO(day);
  const now = new Date();
  const diff = differenceInCalendarDays(date, now);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return format(date, isSameYear(date, now) ? "EEE d MMM" : "d MMM yyyy");
}

export function isPast(day: string): boolean {
  return day < today();
}
