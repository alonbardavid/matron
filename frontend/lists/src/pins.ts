import { useCallback, useState } from "react";

const KEY = "matron.pinnedLists";

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The lists pinned on this device: kept in the browser, not with the list, so
 * each device pins its own.
 */
export function usePinnedLists() {
  const [pinned, setPinned] = useState<string[]>(read);
  const toggle = useCallback((id: string) => {
    setPinned((current) => {
      const next = current.includes(id)
        ? current.filter((held) => held !== id)
        : [...current, id];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Storage may be off: the pin lasts until the page is left.
      }
      return next;
    });
  }, []);
  return { pinned, isPinned: (id: string) => pinned.includes(id), toggle };
}
