/** Formatting for what Cloudflare reports: sizes, spans of time, moments, money. */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** `1.23 MB`: the largest unit that keeps the number above one, two decimals. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value.toFixed(0) : value.toFixed(2)} ${UNITS[unit]}`;
}

/** `2d 3h`, `3h 12m`, `12m`, `40s`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** `3 hours ago`, or the date when it is older than a week. */
export function formatAgo(ts: number, now = Date.now()): string {
  const ms = now - ts;
  if (ms < 0) return formatWhen(ts);
  if (ms < 60_000) return "just now";
  if (ms < 7 * 24 * 3_600_000) return `${formatDuration(ms)} ago`;
  return formatWhen(ts);
}

export function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatUsd(amount: number): string {
  return amount < 0.01 && amount > 0 ? "< $0.01" : `$${amount.toFixed(2)}`;
}
