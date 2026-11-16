import { polyfill } from "mobile-drag-drop";
import { scrollBehaviourDragImageTranslateOverride } from "mobile-drag-drop/scroll-behaviour";
import "mobile-drag-drop/default.css";

/** How long a finger rests on an event before it is picked up; a quicker swipe scrolls. */
const HOLD_MS = 300;

let enabled = false;

/**
 * Lets a finger drag events. The calendar moves them with the browser's drag
 * and drop, which phones do not start from a touch; this starts it from a
 * held finger, and scrolls the calendar when the event nears its edge.
 * Browsers that drag on their own are left as they are.
 */
export function enableTouchDrag(): void {
  if (enabled) return;
  enabled = true;
  const applied = polyfill({
    holdToDrag: HOLD_MS,
    dragImageTranslateOverride: scrollBehaviourDragImageTranslateOverride,
    // Its own lookup reads the touch's path after the hold, by when it is empty.
    tryFindDraggableTarget: (event) =>
      event.target instanceof Element
        ? (event.target.closest<HTMLElement>('[draggable="true"]') ?? undefined)
        : undefined,
  });
  if (!applied) return;
  // Safari on iOS scrolls under a drag unless some touchmove listener may cancel it.
  window.addEventListener("touchmove", () => {}, { passive: false });
  // The polyfill drops only on what accepted the dragenter, as the standard has
  // it; the calendar takes the dragover alone, as browsers let it.
  document.addEventListener("dragenter", (event) => event.preventDefault());
}
