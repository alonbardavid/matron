import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { UnstyledButton } from "@mantine/core";
import classes from "./CalendarItem.module.css";

type EventRootProps = ComponentPropsWithoutRef<"button"> & { children: ReactNode };

/**
 * An event on the calendar as the schedule would draw it. Takes the root props
 * the schedule's `renderEvent` passes, so every view (all-day rows included)
 * draws it alike. `muted` fades an event the member hid; `struck` crosses out
 * a done task.
 */
export function CalendarItem({
  muted = false,
  struck = false,
  className,
  children,
  ...props
}: EventRootProps & { muted?: boolean; struck?: boolean }) {
  return (
    <UnstyledButton
      {...props}
      className={[className, classes.item].filter(Boolean).join(" ")}
      data-muted={muted || undefined}
      data-struck={struck || undefined}
    >
      {children}
    </UnstyledButton>
  );
}
