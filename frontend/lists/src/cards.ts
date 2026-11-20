import type { List, ListItem } from "@shared/contract/app/lists";
import { childrenOf } from "./tree";

/** A list's card shows this many lines of open items. */
const PREVIEW_LINES = 9;

/** One line of a list's card: an open item at the top, or one under it. */
export interface PreviewLine {
  id: string;
  title: string;
  depth: number;
  dueDate: string | null;
  /** For an item with items under it: how many of those are done. */
  progress: { done: number; total: number } | null;
}

/** What a list's card shows of it. */
export interface Card {
  /** Its first open items at the top, each followed by the open items right under it. */
  preview: PreviewLine[];
  /** Whether it has open items beyond the preview. */
  more: boolean;
  completedCount: number;
}

export function cardOf(list: List): Card {
  const children = childrenOf(list.items);
  const open = (item: ListItem) => item.completedAt === null;
  const line = (item: ListItem, depth: number): PreviewLine => {
    const under = children.get(item.id) ?? [];
    return {
      id: item.id,
      title: item.title,
      depth,
      dueDate: item.dueDate,
      progress:
        under.length > 0
          ? { done: under.filter((c) => !open(c)).length, total: under.length }
          : null,
    };
  };
  const lines: PreviewLine[] = [];
  for (const top of (children.get(null) ?? []).filter(open)) {
    lines.push(line(top, 0));
    for (const child of (children.get(top.id) ?? []).filter(open)) {
      lines.push(line(child, 1));
    }
  }
  return {
    preview: lines.slice(0, PREVIEW_LINES),
    more: lines.length > PREVIEW_LINES,
    completedCount: list.items.filter((item) => !open(item)).length,
  };
}

/** Whether the list's name or any of its items' titles holds `q`. */
export function matches(list: List, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return (
    !needle ||
    list.name.toLowerCase().includes(needle) ||
    list.items.some((item) => item.title.toLowerCase().includes(needle))
  );
}
