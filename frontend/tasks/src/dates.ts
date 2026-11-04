import dayjs from "dayjs";

/** Today as a calendar day, `YYYY-MM-DD`. */
export function today(): string {
  return dayjs().format("YYYY-MM-DD");
}

/** "Today", "Tomorrow", "Yesterday", or a short date. */
export function describeDay(day: string): string {
  const date = dayjs(day);
  const diff = date.startOf("day").diff(dayjs().startOf("day"), "day");
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return date.format(date.year() === dayjs().year() ? "ddd D MMM" : "D MMM YYYY");
}

export function isPast(day: string): boolean {
  return day < today();
}
