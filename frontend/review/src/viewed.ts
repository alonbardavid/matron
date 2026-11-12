import { useCallback, useState } from "react";

/**
 * Which changes the reviewer marked viewed, per branch, in this browser only:
 * a review is a quick read before merging, so nothing is stored on the server.
 * A change keeps its mark across rebuilds while its text stays the same.
 */
export function useViewed(branchId: string) {
  const storageKey = `matron.review.viewed.${branchId}`;
  const [viewed, setViewedSet] = useState<Set<string>>(() => load(storageKey));

  const setViewed = useCallback(
    (keys: string[], on: boolean) => {
      setViewedSet((current) => {
        const next = new Set(current);
        for (const key of keys) {
          if (on) next.add(key);
          else next.delete(key);
        }
        save(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  /** How many of `keys` are viewed. */
  const count = useCallback(
    (keys: string[]) => keys.filter((key) => viewed.has(key)).length,
    [viewed],
  );

  return { viewed, setViewed, count };
}

export type Viewed = ReturnType<typeof useViewed>;

function load(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function save(key: string, value: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    // Private mode or a full quota: the marks last for this visit only.
  }
}
