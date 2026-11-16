import { useCallback, useState } from "react";
import type { ReviewFile } from "@shared/contract/arch/review";

/** How a diff is laid out: one column of lines, or the file before on the left and after on the right. */
export type DiffLayout = "unified" | "split";

/**
 * Each diff's layout: every file and every range of a bracket keeps the
 * layout chosen for it during this visit. One not yet chosen opens split when
 * the file was changed, so the old lines sit beside the new, and unified when
 * it was added or deleted, which has only one side to show.
 */
export function useDiffLayouts() {
  const [chosen, setChosen] = useState<Record<string, DiffLayout>>({});

  const layoutOf = useCallback(
    (key: string, status: ReviewFile["status"]): DiffLayout =>
      chosen[key] ?? (status === "modified" ? "split" : "unified"),
    [chosen],
  );

  const setLayout = useCallback((key: string, layout: DiffLayout) => {
    setChosen((current) => ({ ...current, [key]: layout }));
  }, []);

  return { layoutOf, setLayout };
}

export type DiffLayouts = ReturnType<typeof useDiffLayouts>;
