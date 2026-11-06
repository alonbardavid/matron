import { Text } from "@mantine/core";
import { Fragment, useMemo, useRef, useState } from "react";
import { markKey, type FileModel } from "../diff";
import type { Viewed } from "../viewed";
import { MarkBox, markState } from "./Marks";
import classes from "./review.module.css";

interface DiffViewProps {
  model: FileModel;
  /** Show only these lines (in the branch's version), as a bracket range does. */
  focus?: { start: number; end: number };
  viewed: Viewed;
}

/** Unchanged lines shown around each change in a whole-file diff. */
const CONTEXT = 3;

const OMITTED: Record<string, string> = {
  binary: "A binary file; its contents are not shown.",
  "too-large": "Too large to show here.",
  generated: "A generated file; its contents are not shown.",
};

type Segment = { shown: true; lines: number[] } | { shown: false; lines: number[] };

/**
 * A unified diff, marked as IronGarden marks it: a rail beside every changed
 * line toggles its change (shift-click takes in every change since the last
 * one clicked), and a box heads each run of adjacent changes to mark the run.
 * Runs of lines outside the view fold into a row that unfolds them.
 */
export function DiffView({ model, focus, viewed }: DiffViewProps) {
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set());
  const segments = useMemo(() => segmentsOf(model, focus), [model, focus]);
  const lastClicked = useRef<number | null>(null);
  const path = model.file.path;
  const keyOf = (changeIndex: number) => markKey(path, model.changes[changeIndex]!);

  const clickRail = (changeIndex: number, extend: boolean) => {
    const from = extend ? (lastClicked.current ?? changeIndex) : changeIndex;
    lastClicked.current = changeIndex;
    const indexes: number[] = [];
    for (let i = Math.min(from, changeIndex); i <= Math.max(from, changeIndex); i++) {
      indexes.push(i);
    }
    viewed.setViewed(indexes.map(keyOf), !viewed.viewed.has(keyOf(changeIndex)));
  };

  if (model.file.omitted) {
    return (
      <Text size="sm" c="dimmed" p="md">
        {OMITTED[model.file.omitted]}
      </Text>
    );
  }
  if (!segments.some((segment) => segment.shown)) {
    return (
      <Text size="sm" c="dimmed" p="md">
        {focus ? "These lines are not in the file." : "No line changed."}
      </Text>
    );
  }

  return (
    <table className={classes.diff}>
      {/* A fixed layout takes its widths from here, not from a folded first row. */}
      <colgroup>
        <col className={classes.blockCol} />
        <col className={classes.railCol} />
        <col className={classes.numberCol} />
        <col className={classes.numberCol} />
        <col className={classes.signCol} />
        <col />
      </colgroup>
      <tbody>
        {segments.map((segment) => {
          const first = segment.lines[0]!;
          if (!segment.shown && !unfolded.has(first)) {
            return (
              <tr key={`gap-${first}`} className={classes.gap}>
                <td colSpan={6}>
                  <button
                    type="button"
                    className={classes.gapButton}
                    onClick={() => setUnfolded((current) => new Set(current).add(first))}
                  >
                    Show {segment.lines.length} hidden line
                    {segment.lines.length === 1 ? "" : "s"}
                  </button>
                </td>
              </tr>
            );
          }
          const blocks = blocksOf(segment.lines, model.changeOf);
          return (
            <Fragment key={`lines-${first}`}>
              {segment.lines.map((index, row) => {
                const line = model.lines[index]!;
                const changeIndex = model.changeOf[index]!;
                const isViewed =
                  changeIndex >= 0 && viewed.viewed.has(keyOf(changeIndex));
                const block = blocks[row];
                const lineNumber = line.kind === "removed" ? line.old : line.new;
                const rowClass = [
                  line.kind === "added" && classes.added,
                  line.kind === "removed" && classes.removed,
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr key={index} className={rowClass}>
                    <td
                      className={`${classes.blockCell} ${block && !block.head ? classes.blockLine : ""}`}
                    >
                      {block?.head && (
                        <BlockBox keys={block.changes.map(keyOf)} viewed={viewed} />
                      )}
                    </td>
                    {changeIndex >= 0 ? (
                      <td
                        role="checkbox"
                        tabIndex={0}
                        aria-checked={isViewed}
                        aria-label={`${isViewed ? "Unmark" : "Mark"} line ${lineNumber} viewed. Shift-click for a range.`}
                        title={`${isViewed ? "Unmark" : "Mark"} this change viewed. Shift-click for a range.`}
                        className={`${classes.rail} ${isViewed ? classes.railOn : ""}`}
                        // Keeps a shift-click from selecting the code it passes over.
                        onMouseDown={(event) => event.shiftKey && event.preventDefault()}
                        onClick={(event) => clickRail(changeIndex, event.shiftKey)}
                        onKeyDown={(event) => {
                          if (event.key !== " " && event.key !== "Enter") return;
                          event.preventDefault();
                          clickRail(changeIndex, event.shiftKey);
                        }}
                      />
                    ) : (
                      <td />
                    )}
                    <td className={classes.number}>
                      {line.kind !== "added" ? line.old : ""}
                    </td>
                    <td className={classes.number}>
                      {line.kind !== "removed" ? line.new : ""}
                    </td>
                    <td className={classes.sign}>
                      {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}
                    </td>
                    <td className={classes.code}>{line.text || " "}</td>
                  </tr>
                );
              })}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/** The box heading a run of adjacent changes: ticked when all are viewed, part-filled when some are. */
function BlockBox({ keys, viewed }: { keys: string[]; viewed: Viewed }) {
  const state = markState(viewed.count(keys), keys.length);
  return (
    <MarkBox
      state={state}
      label={`${state === "all" ? "Unmark" : "Mark"} these ${keys.length} changes viewed`}
      onToggle={() => viewed.setViewed(keys, state !== "all")}
    />
  );
}

/**
 * For each shown row, the run of adjacent changed rows it is in, when that
 * run holds more than one change; `head` is its first row.
 */
function blocksOf(
  rows: number[],
  changeOf: number[],
): ({ head: boolean; changes: number[] } | null)[] {
  const result: ({ head: boolean; changes: number[] } | null)[] = rows.map(() => null);
  let from = 0;
  while (from < rows.length) {
    let to = from;
    while (to < rows.length && changeOf[rows[to]!]! >= 0) to++;
    const changes = [...new Set(rows.slice(from, to).map((index) => changeOf[index]!))];
    if (changes.length > 1) {
      for (let i = from; i < to; i++) result[i] = { head: i === from, changes };
    }
    from = to + 1;
  }
  return result;
}

/** The file's lines split into the runs shown and the runs folded away. */
function segmentsOf(model: FileModel, focus?: { start: number; end: number }): Segment[] {
  const { lines, owners } = model;
  const interest = lines.map((line, i) =>
    focus ? owners[i]! >= focus.start && owners[i]! <= focus.end : line.kind !== "same",
  );
  const context = focus ? 0 : CONTEXT;
  const shown = lines.map((_, i) => {
    for (
      let j = Math.max(0, i - context);
      j <= Math.min(lines.length - 1, i + context);
      j++
    ) {
      if (interest[j]) return true;
    }
    return false;
  });
  const segments: Segment[] = [];
  shown.forEach((isShown, i) => {
    const last = segments[segments.length - 1];
    if (last && last.shown === isShown) last.lines.push(i);
    else segments.push({ shown: isShown, lines: [i] } as Segment);
  });
  return segments;
}
