import type { ListItem } from "@shared/contract/app/lists";

/** One row of a list's page: an item and how deep it is. */
export interface Row {
  item: ListItem;
  depth: number;
}

/** Where a moved item goes: under `parentId` (null: the top) at `index` among the items there. */
export interface Placement {
  parentId: string | null;
  index: number;
}

function byPosition(a: ListItem, b: ListItem): number {
  return a.position - b.position || a.createdAt - b.createdAt;
}

/** Each item's children in order, keyed by parent (null for the top). */
export function childrenOf(items: ListItem[]): Map<string | null, ListItem[]> {
  const out = new Map<string | null, ListItem[]>();
  for (const item of items) {
    out.set(item.parentId, [...(out.get(item.parentId) ?? []), item]);
  }
  for (const list of out.values()) list.sort(byPosition);
  return out;
}

/**
 * The rows under each of `tops`, depth first. Done items under an open one
 * stay in place, crossed out.
 */
export function rowsOf(
  tops: ListItem[],
  children: Map<string | null, ListItem[]>,
): Row[] {
  const rows: Row[] = [];
  const walk = (item: ListItem, depth: number) => {
    rows.push({ item, depth });
    for (const child of children.get(item.id) ?? []) walk(child, depth + 1);
  };
  for (const top of tops) walk(top, 0);
  return rows;
}

/** The item's id and every id under it. */
export function subtreeIds(
  children: Map<string | null, ListItem[]>,
  id: string,
): Set<string> {
  const out = new Set<string>([id]);
  const walk = (parent: string) => {
    for (const child of children.get(parent) ?? []) {
      out.add(child.id);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

/**
 * Where a dragged item lands when dropped before `rows[insertAt]` (the rows
 * without it and what is under it), at `depth`: under the nearest row above
 * one level up, after the last of its children shown above the drop. The
 * index is among all the items there, shown or not.
 */
export function placementAt(
  rows: Row[],
  insertAt: number,
  depth: number,
  children: Map<string | null, ListItem[]>,
  movingId: string,
): Placement {
  let parentId: string | null = null;
  if (depth > 0) {
    for (let i = insertAt - 1; i >= 0; i--) {
      if (rows[i]!.depth === depth - 1) {
        parentId = rows[i]!.item.id;
        break;
      }
    }
  }
  const siblings = (children.get(parentId) ?? []).filter((item) => item.id !== movingId);
  let before: ListItem | undefined;
  for (let i = insertAt - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (row.depth < depth) break;
    if (row.depth === depth && row.item.parentId === parentId) {
      before = row.item;
      break;
    }
  }
  if (before) return { parentId, index: siblings.indexOf(before) + 1 };
  const after = rows
    .slice(insertAt)
    .find((row) => row.depth === depth && row.item.parentId === parentId);
  return { parentId, index: after ? siblings.indexOf(after.item) : 0 };
}

/** How deep a drop before `rows[insertAt]` may go: no deeper than one under the row above, no shallower than the row below. */
export function depthBounds(rows: Row[], insertAt: number): { min: number; max: number } {
  const above = rows[insertAt - 1];
  const below = rows[insertAt];
  const max = above ? above.depth + 1 : 0;
  const min = below ? Math.min(below.depth, max) : 0;
  return { min, max };
}

/** The items after a move, as the server will have them: the moved item placed, its new neighbours renumbered. */
export function applyMove(
  items: ListItem[],
  id: string,
  { parentId, index }: Placement,
): ListItem[] {
  const moving = items.find((item) => item.id === id);
  if (!moving) return items;
  const siblings = items
    .filter((item) => item.parentId === parentId && item.id !== id)
    .sort(byPosition);
  const order = [...siblings];
  order.splice(Math.min(index, order.length), 0, moving);
  const positions = new Map(order.map((item, position) => [item.id, position]));
  return items.map((item) => {
    const position = positions.get(item.id);
    if (position === undefined) return item;
    return item.id === id ? { ...item, parentId, position } : { ...item, position };
  });
}

/** Moving an item up or down among those beside it, in or out a level: where it goes, or null when it cannot. */
export function nudge(
  items: ListItem[],
  item: ListItem,
  how: "up" | "down" | "in" | "out",
): Placement | null {
  const children = childrenOf(items);
  const siblings = children.get(item.parentId) ?? [];
  const at = siblings.findIndex((s) => s.id === item.id);
  switch (how) {
    case "up":
      return at > 0 ? { parentId: item.parentId, index: at - 1 } : null;
    case "down":
      return at < siblings.length - 1 ? { parentId: item.parentId, index: at + 1 } : null;
    case "in": {
      const above = siblings[at - 1];
      return above
        ? { parentId: above.id, index: (children.get(above.id) ?? []).length }
        : null;
    }
    case "out": {
      if (item.parentId === null) return null;
      const parent = items.find((p) => p.id === item.parentId);
      if (!parent) return null;
      const around = children.get(parent.parentId) ?? [];
      return {
        parentId: parent.parentId,
        index: around.findIndex((p) => p.id === parent.id) + 1,
      };
    }
  }
}
