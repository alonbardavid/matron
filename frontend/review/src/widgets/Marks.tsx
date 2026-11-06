import type { ReactNode } from "react";
import classes from "./review.module.css";

export type MarkState = "all" | "some" | "none";

export function markState(done: number, total: number): MarkState {
  return total > 0 && done >= total ? "all" : done > 0 ? "some" : "none";
}

/** A small square that marks several changes at once: empty, part-filled or ticked. */
export function MarkBox({
  state,
  label,
  onToggle,
}: {
  state: MarkState;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
      aria-label={label}
      title={label}
      className={`${classes.box} ${classes[`box-${state}`]}`}
      onClick={onToggle}
    >
      <Tick visible={state === "all"} />
    </button>
  );
}

/** The box with a word beside it, as one outlined button: a file's or a range's mark. */
export function MarkButton({
  state,
  label,
  children,
  onToggle,
}: {
  state: MarkState;
  label: string;
  children: ReactNode;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
      aria-label={label}
      title={label}
      className={classes.markButton}
      onClick={onToggle}
    >
      <span aria-hidden className={`${classes.box} ${classes[`box-${state}`]}`}>
        <Tick visible={state === "all"} />
      </span>
      {children}
    </button>
  );
}

function Tick({ visible }: { visible: boolean }) {
  return (
    <svg
      width={9}
      height={9}
      viewBox="0 0 16 16"
      fill="none"
      stroke="white"
      strokeWidth={2.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ visibility: visible ? "visible" : "hidden" }}
    >
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}
