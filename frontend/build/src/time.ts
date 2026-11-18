const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The clock time of a moment, without its date: `14:02`. */
export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The whole moment, for a tooltip. */
export function formatMoment(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * How long ago a moment was, as a chat says it: `just now`, `10 minutes ago`,
 * `3 hours ago` for today, `yesterday`, and the date for anything older.
 */
export function formatAgo(ts: number, now: number = Date.now()): string {
  const ms = now - ts;
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), "minute");
  const at = new Date(ts);
  const today = new Date(now);
  if (at.toDateString() === today.toDateString()) {
    return plural(Math.floor(ms / HOUR), "hour");
  }
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return "yesterday";
  return at.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(at.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/** How long something took: `45s`, `4m 12s`, `1h 03m`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${seconds}s`;
}
