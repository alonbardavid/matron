import { useCallback, useState } from "react";

/** How a diff is laid out: one column of lines, or the file before on the left and after on the right. */
export type DiffLayout = "unified" | "split";

const STORAGE_KEY = "matron.review.layout";

/**
 * Each diff's layout: every file and every range of a bracket keeps the
 * layout chosen for it during this visit. One not yet chosen opens with the
 * layout this browser last saved, so a choice never moves the diffs beside it;
 * each choice is saved for the next visit.
 */
export function useDiffLayouts() {
  const [fallback] = useState<DiffLayout>(load);
  const [chosen, setChosen] = useState<Record<string, DiffLayout>>({});

  const layoutOf = useCallback(
    (key: string): DiffLayout => chosen[key] ?? fallback,
    [chosen, fallback],
  );

  const setLayout = useCallback((key: string, layout: DiffLayout) => {
    setChosen((current) => ({ ...current, [key]: layout }));
    try {
      localStorage.setItem(STORAGE_KEY, layout);
    } catch {
      // Private mode or a full quota: the choice lasts for this visit only.
    }
  }, []);

  return { layoutOf, setLayout };
}

export type DiffLayouts = ReturnType<typeof useDiffLayouts>;

function load(): DiffLayout {
  try {
    return localStorage.getItem(STORAGE_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}
