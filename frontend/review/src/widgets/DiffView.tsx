import { Text } from "@mantine/core";
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { CodeTokens } from "@frontend/ds/code/Code";
import { highlightLines, languageOfPath, type Token } from "@frontend/ds/code/highlight";
import { markKey, splitRows, type DiffLine, type FileModel } from "../diff";
import type { DiffLayout } from "../layout";
import type { Viewed } from "../viewed";
import { MarkBox, markState } from "./Marks";
import classes from "./review.module.css";

interface DiffViewProps {
  model: FileModel;
  /** Show only these lines (in the branch's version), as a bracket range does. */
  focus?: { start: number; end: number };
  viewed: Viewed;
  layout?: DiffLayout;
}

/** Unchanged lines shown around each change in a whole-file diff. */
const CONTEXT = 3;

const OMITTED: Record<string, string> = {
  binary: "A binary file; its contents are not shown.",
  "too-large": "Too large to show here.",
  generated: "A generated file; its contents are not shown.",
};

type Segment = { shown: true; lines: number[] } | { shown: false; lines: number[] };

/** One table row: a line in the unified layout, or a pair of sides in the split one. */
type Row = { left: number | null; right: number | null };

/**
 * A diff, marked as IronGarden marks it: a rail beside every changed line
 * toggles its change (shift-click takes in every change since the last one
 * clicked), and a box heads each run of adjacent changes to mark the run.
 * Runs of lines outside the view fold into a row that unfolds them. Unified
 * shows one column of lines; split shows the file before on the left and
 * after on the right, a removed line beside the line that replaced it.
 */
export function DiffView({ model, focus, viewed, layout = "unified" }: DiffViewProps) {
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set());
  const segments = useMemo(() => segmentsOf(model, focus), [model, focus]);
  const tokens = useMemo(() => lineTokens(model), [model]);
  const lastClicked = useRef<number | null>(null);
  const path = model.file.path;
  const keyOf = (changeIndex: number) => markKey(path, model.changes[changeIndex]!);
  const split = layout === "split";

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

  const code = (index: number) => {
    const line = tokens[index]!;
    return line.length ? <CodeTokens tokens={line} /> : " ";
  };

  return (
    <table className={`${classes.diff} ${split ? classes.split : ""}`}>
      {/* A fixed layout takes its widths from here, not from a folded first row. */}
      {split ? (
        <colgroup>
          <col className={classes.blockCol} />
          <col className={classes.railCol} />
          <col className={classes.numberCol} />
          <col />
          <col className={classes.numberCol} />
          <col />
        </colgroup>
      ) : (
        <colgroup>
          <col className={classes.blockCol} />
          <col className={classes.railCol} />
          <col className={classes.numberCol} />
          <col className={classes.numberCol} />
          <col className={classes.signCol} />
          <col />
        </colgroup>
      )}
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
          const rows: Row[] = split
            ? splitRows(model.lines, segment.lines)
            : segment.lines.map((index) => ({ left: index, right: index }));
          // A row's change: the one its lines make (a split row's two sides are one change).
          const rowChanges = rows.map((row) => model.changeOf[(row.right ?? row.left)!]!);
          const blocks = blocksOf(rowChanges);
          return (
            <Fragment key={`lines-${first}`}>
              {rows.map((row, r) => {
                const changeIndex = rowChanges[r]!;
                const isViewed =
                  changeIndex >= 0 && viewed.viewed.has(keyOf(changeIndex));
                const block = blocks[r];
                const shownLine = model.lines[(row.right ?? row.left)!]!;
                const lineNumber =
                  shownLine.kind === "removed" ? shownLine.old : shownLine.new;
                const head = (
                  <>
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
                  </>
                );
                if (split) {
                  return (
                    <tr key={`${row.left}-${row.right}`}>
                      {head}
                      <Side
                        line={row.left === null ? null : model.lines[row.left]!}
                        side="left"
                      >
                        {row.left === null ? null : code(row.left)}
                      </Side>
                      <Side
                        line={row.right === null ? null : model.lines[row.right]!}
                        side="right"
                      >
                        {row.right === null ? null : code(row.right)}
                      </Side>
                    </tr>
                  );
                }
                const rowClass =
                  shownLine.kind === "added"
                    ? classes.added
                    : shownLine.kind === "removed"
                      ? classes.removed
                      : "";
                return (
                  <tr key={row.right!} className={rowClass}>
                    {head}
                    <td className={classes.number}>
                      {shownLine.kind !== "added" ? shownLine.old : ""}
                    </td>
                    <td className={classes.number}>
                      {shownLine.kind !== "removed" ? shownLine.new : ""}
                    </td>
                    <td className={classes.sign}>
                      {shownLine.kind === "added"
                        ? "+"
                        : shownLine.kind === "removed"
                          ? "−"
                          : ""}
                    </td>
                    <td className={classes.code}>{code(row.right!)}</td>
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

/**
 * One side of a split row: its line number and code, tinted when the line
 * was removed (left) or added (right), shaded when that side has no line.
 */
function Side({
  line,
  side,
  children,
}: {
  line: DiffLine | null;
  side: "left" | "right";
  children: ReactNode;
}) {
  const tint =
    line === null
      ? classes.blank
      : line.kind === "removed"
        ? classes.removed
        : line.kind === "added"
          ? classes.added
          : "";
  const number = line === null ? "" : side === "left" ? oldNumber(line) : newNumber(line);
  return (
    <>
      <td className={`${classes.number} ${tint}`}>{number}</td>
      <td
        className={`${classes.code} ${tint} ${side === "left" ? classes.leftCode : ""}`}
      >
        {children}
      </td>
    </>
  );
}

function oldNumber(line: DiffLine): number | "" {
  return line.kind === "added" ? "" : line.old;
}

function newNumber(line: DiffLine): number | "" {
  return line.kind === "removed" ? "" : line.new;
}

/**
 * Each line's coloured tokens: a removed line from the file before, every
 * other line from the file after, each highlighted whole so a comment or
 * string that spans lines keeps its colour. A line whose tokens do not
 * spell its text (a file the diff split differently) is shown plain.
 */
function lineTokens(model: FileModel): Token[][] {
  const language = languageOfPath(model.file.path);
  const before = highlightLines(model.file.before ?? "", language);
  const after = highlightLines(model.file.after ?? "", language);
  return model.lines.map((line) => {
    const tokens = line.kind === "removed" ? before[line.old - 1] : after[line.new - 1];
    const spelled = tokens?.map((token) => token.text).join("");
    if (spelled === line.text) return tokens!;
    return line.text ? [{ text: line.text }] : [];
  });
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
 * For each row, the run of adjacent changed rows it is in, when that run
 * holds more than one change; `head` is its first row. `rowChanges` is each
 * row's change, or -1 for an unchanged row.
 */
function blocksOf(rowChanges: number[]): ({ head: boolean; changes: number[] } | null)[] {
  const result: ({ head: boolean; changes: number[] } | null)[] = rowChanges.map(
    () => null,
  );
  let from = 0;
  while (from < rowChanges.length) {
    let to = from;
    while (to < rowChanges.length && rowChanges[to]! >= 0) to++;
    const changes = [...new Set(rowChanges.slice(from, to))];
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
