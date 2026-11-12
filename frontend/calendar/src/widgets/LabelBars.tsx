import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import { UnstyledButton } from "@mantine/core";
import type { Label } from "@shared/contract/app/calendar";
import classes from "./LabelBars.module.css";

/** The labels among `labelIds`, in the household's order of labels. */
export function labelsOf(labelIds: readonly string[], labels: readonly Label[]): Label[] {
  return labels.filter((label) => labelIds.includes(label.id));
}

function Bars({ labels, className }: { labels: Label[]; className?: string }) {
  return (
    <span className={className} data-testid="label-bars">
      {labels.map((label) => (
        <span
          key={label.id}
          className={classes.bar}
          style={{ backgroundColor: label.color }}
          title={label.name}
        />
      ))}
    </span>
  );
}

type EventRootProps = ComponentPropsWithoutRef<"button"> & { children: ReactNode };

/**
 * An event on the calendar as the schedule would draw it, with its labels as
 * coloured bars along its leading edge. Takes the root props the schedule's
 * `renderEvent` passes, so every view (all-day rows included) draws it alike.
 */
export function LabelledEvent({
  labels,
  className,
  style,
  children,
  ...props
}: EventRootProps & { labels: Label[] }) {
  if (labels.length === 0) {
    return (
      <UnstyledButton className={className} style={style} {...props}>
        {children}
      </UnstyledButton>
    );
  }
  return (
    <UnstyledButton
      {...props}
      className={[className, classes.labelled].filter(Boolean).join(" ")}
      style={{ ...style, "--label-count": labels.length } as CSSProperties}
    >
      <Bars labels={labels} className={classes.bars} />
      {children}
    </UnstyledButton>
  );
}

/** The bars alone, in a line of text: where an event is a row rather than a block. */
export function InlineLabelBars({ labels }: { labels: Label[] }) {
  if (labels.length === 0) return null;
  return <Bars labels={labels} className={classes.inline} />;
}
