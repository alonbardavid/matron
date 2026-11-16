import { Progress } from "@mantine/core";

/** How much of something was viewed, as a thin bar. */
export function ViewedBar({ done, total }: { done: number; total: number }) {
  return (
    <Progress
      size={5}
      color="sage"
      value={total ? (done / total) * 100 : 100}
      aria-label={`${done} of ${total} changes viewed`}
    />
  );
}

/** "3 left", or "viewed" once nothing is. */
export function leftLabel(done: number, total: number): string {
  return done >= total ? "viewed" : `${total - done} left`;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** A file's state in the tree: an empty, a half or a full circle. */
export function ViewedIcon({ done, total }: { done: number; total: number }) {
  const state = done >= total ? "done" : done > 0 ? "partial" : "none";
  const label =
    state === "done" ? "Viewed" : state === "partial" ? "Partly viewed" : "Not viewed";
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" role="img" aria-label={label}>
      {state === "done" ? (
        <>
          <circle cx="8" cy="8" r="7" fill="var(--mantine-color-sage-6)" />
          <path
            d="m5 8.25 2 2 4-4.5"
            fill="none"
            stroke="white"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.25"
            fill="none"
            stroke={
              state === "partial"
                ? "var(--mantine-color-sage-6)"
                : "var(--matron-border-strong)"
            }
            strokeWidth="1.5"
          />
          {state === "partial" && (
            <path d="M8 3.5a4.5 4.5 0 0 1 0 9z" fill="var(--mantine-color-sage-6)" />
          )}
        </>
      )}
    </svg>
  );
}
