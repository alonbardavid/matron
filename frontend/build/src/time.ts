/** The time of a chat frame: the clock for today, the date as well otherwise. */
export function formatStamp(ts: number, now: number = Date.now()): string {
  const at = new Date(ts);
  const today = new Date(now);
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (at.toDateString() === today.toDateString()) return time;
  const date = at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return at.getFullYear() === today.getFullYear()
    ? `${date} ${time}`
    : `${at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} ${time}`;
}
