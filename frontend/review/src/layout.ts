import { useCallback, useState } from "react";

/** How a diff is laid out: one column of lines, or the file before on the left and after on the right. */
export type DiffLayout = "unified" | "split";

const STORAGE_KEY = "matron.review.layout";

/** The reviewer's diff layout, remembered in this browser for every branch. */
export function useDiffLayout(): [DiffLayout, (layout: DiffLayout) => void] {
  const [layout, setState] = useState<DiffLayout>(load);
  const setLayout = useCallback((next: DiffLayout) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode or a full quota: the choice lasts for this visit only.
    }
  }, []);
  return [layout, setLayout];
}

function load(): DiffLayout {
  try {
    return localStorage.getItem(STORAGE_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}
