import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * For the day and week views: their hours scroll inside the view, which reaches
 * down to the window's bottom edge, and a view opens with the time now in the
 * middle of its hours.
 */
export function useTimeGrid(): {
  viewportRef: RefObject<HTMLDivElement | null>;
  maxHeight: string | undefined;
} {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  const centred = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const at = Math.round(viewport.getBoundingClientRect().top + window.scrollY);
    if (at !== top) {
      setTop(at);
      return;
    }
    if (centred.current === viewport) return;
    centred.current = viewport;
    centreOnNow(viewport);
  });
  return {
    viewportRef,
    maxHeight:
      top === null ? undefined : `calc(100dvh - ${top}px - var(--mantine-spacing-md))`,
  };
}

function centreOnNow(viewport: HTMLElement): void {
  const [first, second] = viewport.querySelectorAll<HTMLElement>(
    "[data-hour-start]:not([data-all-day])",
  );
  if (!first || !second) return;
  const firstTop = first.getBoundingClientRect().top;
  const hour = second.getBoundingClientRect().top - firstTop;
  // What is above the hours (the days, the all-day row) stays over them as they scroll.
  const above = firstTop - viewport.getBoundingClientRect().top + viewport.scrollTop;
  const now = new Date();
  const fromMidnight = (now.getHours() + now.getMinutes() / 60) * hour;
  viewport.scrollTo({ top: fromMidnight - (viewport.clientHeight - above) / 2 });
}
