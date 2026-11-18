import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Checkbox,
  Group,
  Menu,
  Text,
  UnstyledButton,
} from "@mantine/core";
import type { ListItem } from "@shared/contract/app/lists";
import { PeopleAvatars } from "@frontend/auth/widgets/PeopleAvatars";
import { IconChevronRight, IconDots, IconGrip } from "@frontend/ds/icons";
import { describeDay, isPast } from "../dates";
import {
  depthBounds,
  nudge,
  placementAt,
  subtreeIds,
  type Placement,
  type Row,
} from "../tree";
import classes from "./ItemTree.module.css";

/** How far in each level of items sits, and how far a drag goes to change level. */
const INDENT = 28;

interface Drag {
  id: string;
  moving: Set<string>;
  /** The rows the item can be dropped among: all but it and what is under it. */
  rest: Row[];
  /** Each row's top and bottom, from the top of the tree, when the drag began. */
  bounds: Map<string, { top: number; bottom: number }>;
  startX: number;
  startY: number;
  startDepth: number;
  dx: number;
  dy: number;
  insertAt: number;
  depth: number;
}

interface ItemTreeProps {
  rows: Row[];
  items: ListItem[];
  childMap: Map<string | null, ListItem[]>;
  /** Whether the caller may change the list's items. */
  editable: boolean;
  /** Whether rows can be dragged; the completed ones cannot. */
  draggable: boolean;
  folded: ReadonlySet<string>;
  onFold: (id: string) => void;
  onToggle: (item: ListItem, completed: boolean) => void;
  onOpen: (item: ListItem) => void;
  onAddUnder: (item: ListItem) => void;
  onMove: (item: ListItem, placement: Placement, listId?: string) => void;
  /** The other lists the caller may move items to. */
  otherLists: { id: string; name: string }[];
}

/**
 * A list's items as an indented tree. Each can be dragged by its handle: up
 * and down to reorder it, right to put it under the item above, left to take
 * it out a level; the items under it go with it. Its menu does the same
 * without dragging, and moves it to another list.
 */
export function ItemTree(props: ItemTreeProps) {
  const { rows, childMap: children, editable, draggable } = props;
  const container = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const begin = (event: ReactPointerEvent<HTMLButtonElement>, row: Row) => {
    if (event.button !== 0 || !container.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const top = container.current.getBoundingClientRect().top;
    const bounds = new Map<string, { top: number; bottom: number }>();
    for (const element of container.current.querySelectorAll<HTMLElement>(
      "[data-row-id]",
    )) {
      const rect = element.getBoundingClientRect();
      bounds.set(element.dataset.rowId!, {
        top: rect.top - top,
        bottom: rect.bottom - top,
      });
    }
    const moving = subtreeIds(children, row.item.id);
    const rest = rows.filter((r) => !moving.has(r.item.id));
    const at = rows.indexOf(row);
    const insertAt = rows.slice(0, at).filter((r) => !moving.has(r.item.id)).length;
    setDrag({
      id: row.item.id,
      moving,
      rest,
      bounds,
      startX: event.clientX,
      startY: event.clientY,
      startDepth: row.depth,
      dx: 0,
      dy: 0,
      insertAt,
      depth: row.depth,
    });
  };

  const follow = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || !container.current) return;
    const y = event.clientY - container.current.getBoundingClientRect().top;
    const insertAt = drag.rest.filter((r) => {
      const b = drag.bounds.get(r.item.id);
      return b !== undefined && (b.top + b.bottom) / 2 < y;
    }).length;
    const dx = event.clientX - drag.startX;
    const { min, max } = depthBounds(drag.rest, insertAt);
    const depth = Math.max(min, Math.min(max, drag.startDepth + Math.round(dx / INDENT)));
    setDrag({ ...drag, dx, dy: event.clientY - drag.startY, insertAt, depth });
  };

  const drop = () => {
    if (!drag) return;
    setDrag(null);
    if (Math.abs(drag.dy) < 4 && Math.abs(drag.dx) < INDENT / 2) return;
    const item = props.items.find((i) => i.id === drag.id);
    if (!item) return;
    const placement = placementAt(
      drag.rest,
      drag.insertAt,
      drag.depth,
      children,
      drag.id,
    );
    const now = (children.get(item.parentId) ?? []).findIndex((s) => s.id === item.id);
    const same = placement.parentId === item.parentId && placement.index === now;
    if (!same) props.onMove(item, placement);
  };

  const indicatorTop = (() => {
    if (!drag) return 0;
    const next = drag.rest[drag.insertAt];
    if (next) return drag.bounds.get(next.item.id)?.top ?? 0;
    const last = drag.rest[drag.rest.length - 1];
    return last ? (drag.bounds.get(last.item.id)?.bottom ?? 0) : 0;
  })();

  return (
    <div ref={container} className={classes.tree} data-dragging={drag ? true : undefined}>
      {rows.map((row, index) => {
        const { item } = row;
        const done = item.completedAt !== null;
        const lifted = drag?.moving.has(item.id);
        const under = children.get(item.id) ?? [];
        const progress = under.length
          ? `${under.filter((c) => c.completedAt !== null).length}/${under.length}`
          : null;
        return (
          <Group
            key={item.id}
            data-row-id={item.id}
            data-item-row={item.title}
            gap={6}
            wrap="nowrap"
            className={classes.row}
            data-first={index === 0 || undefined}
            data-lifted={lifted || undefined}
            style={{
              paddingLeft: 6 + row.depth * INDENT,
              transform: lifted ? `translate(${drag!.dx}px, ${drag!.dy}px)` : undefined,
            }}
          >
            {editable && draggable ? (
              <button
                type="button"
                className={classes.handle}
                aria-label={`Drag ${item.title}`}
                title="Drag to reorder; right to put it under the item above"
                onPointerDown={(event) => begin(event, row)}
                onPointerMove={follow}
                onPointerUp={drop}
                onPointerCancel={() => setDrag(null)}
              >
                <IconGrip size={16} />
              </button>
            ) : (
              <Box w={editable ? 24 : 4} />
            )}
            {row.hasChildren ? (
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-expanded={!props.folded.has(item.id)}
                aria-label={`Items under ${item.title}`}
                onClick={() => props.onFold(item.id)}
                className={classes.fold}
                data-open={!props.folded.has(item.id) || undefined}
              >
                <IconChevronRight size={14} />
              </ActionIcon>
            ) : (
              <Box w={22} style={{ flex: "none" }} />
            )}
            <Checkbox
              checked={done}
              onChange={(e) => props.onToggle(item, e.currentTarget.checked)}
              aria-label={item.title}
              disabled={!editable}
            />
            <UnstyledButton
              onClick={() => props.onOpen(item)}
              style={{ flex: 1, minWidth: 0 }}
              px={4}
            >
              <Text
                size="sm"
                c={done ? "dimmed" : undefined}
                td={done ? "line-through" : undefined}
              >
                {item.title}
              </Text>
              {item.description && (
                <Text size="xs" c="dimmed" truncate>
                  {item.description}
                </Text>
              )}
            </UnstyledButton>
            {progress && (
              <Badge size="sm" variant="light" color="gray">
                {progress}
              </Badge>
            )}
            {item.dueDate && (
              <Badge
                size="sm"
                variant="light"
                color={!done && isPast(item.dueDate) ? "red" : done ? "gray" : "rose"}
              >
                {describeDay(item.dueDate)}
              </Badge>
            )}
            <PeopleAvatars ids={item.assignees} max={3} />
            {editable && <ItemMenu {...props} item={item} />}
          </Group>
        );
      })}
      {drag && (
        <div
          className={classes.indicator}
          style={{ top: indicatorTop - 1, left: 36 + drag.depth * INDENT }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** The same moves as dragging, and moving to another list. */
function ItemMenu({
  item,
  items,
  onAddUnder,
  onMove,
  otherLists,
}: ItemTreeProps & { item: ListItem }) {
  const move = (how: "up" | "down" | "in" | "out") => {
    const placement = nudge(items, item, how);
    if (placement) onMove(item, placement);
  };
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={`Options for ${item.title}`}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => onAddUnder(item)}>Add a subitem</Menu.Item>
        <Menu.Divider />
        <Menu.Item disabled={!nudge(items, item, "up")} onClick={() => move("up")}>
          Move up
        </Menu.Item>
        <Menu.Item disabled={!nudge(items, item, "down")} onClick={() => move("down")}>
          Move down
        </Menu.Item>
        <Menu.Item disabled={!nudge(items, item, "in")} onClick={() => move("in")}>
          Put under the item above
        </Menu.Item>
        <Menu.Item disabled={!nudge(items, item, "out")} onClick={() => move("out")}>
          Move out a level
        </Menu.Item>
        {otherLists.length > 0 && (
          <>
            <Menu.Divider />
            <Menu.Sub>
              <Menu.Sub.Target>
                <Menu.Sub.Item>Move to list</Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                {otherLists.map((list) => (
                  <Menu.Item
                    key={list.id}
                    onClick={() =>
                      onMove(item, { parentId: null, index: 1_000_000 }, list.id)
                    }
                  >
                    {list.name}
                  </Menu.Item>
                ))}
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
