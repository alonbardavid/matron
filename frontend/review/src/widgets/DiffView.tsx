import { Checkbox, Text } from "@mantine/core";
import { Fragment, useMemo, useState } from "react";
import { markKey, type FileModel } from "../diff";
import type { Viewed } from "../viewed";
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
 * A unified diff. The first line of each change carries its "viewed" box;
 * runs of lines outside the view fold into a row that unfolds them.
 */
export function DiffView({ model, focus, viewed }: DiffViewProps) {
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set());
  const segments = useMemo(() => segmentsOf(model, focus), [model, focus]);
  const path = model.file.path;

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
        <col className={classes.markCol} />
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
                <td colSpan={5}>
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
          return (
            <Fragment key={`lines-${first}`}>
              {segment.lines.map((index) => {
                const line = model.lines[index]!;
                const changeIndex = model.changeOf[index]!;
                const change = changeIndex >= 0 ? model.changes[changeIndex] : undefined;
                const key = change ? markKey(path, change) : null;
                const isViewed = key !== null && viewed.viewed.has(key);
                const leads = change?.lines[0] === index;
                const rowClass = [
                  line.kind === "added" && classes.added,
                  line.kind === "removed" && classes.removed,
                  isViewed && classes.viewed,
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr key={index} className={rowClass}>
                    <td className={classes.mark}>
                      {leads && key && (
                        <Checkbox
                          size="xs"
                          color="sage"
                          aria-label={`Viewed line ${line.kind === "removed" ? line.old : line.new}`}
                          checked={isViewed}
                          onChange={(event) =>
                            viewed.setViewed([key], event.currentTarget.checked)
                          }
                        />
                      )}
                    </td>
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
