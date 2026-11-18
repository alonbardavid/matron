import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { Drawer, type DrawerProps } from "@mantine/core";
import { useLocalStorage, useMediaQuery, useViewportSize } from "@mantine/hooks";
import classes from "./SidePanel.module.css";

const DEFAULT_WIDTH = 440;
const MIN_WIDTH = 360;
/** What stays of the page beside the widest panel. */
const PAGE_MARGIN = 120;
const KEY_STEP = 32;
/** The `sm` breakpoint, below which the stylesheet hides the handle. */
const ROOMY = "(min-width: 48em)";

const { handle, ...drawerClasses } = classes;

/**
 * A chat-sized panel at the right edge, over the page without an overlay, its
 * header on the shell's plum. On a wide screen its left edge drags to widen
 * it; the width is this browser's, and every panel shares it.
 */
export function SidePanel({ children, ...props }: DrawerProps) {
  const [stored, setStored] = useLocalStorage<number>({
    key: "matron.side-panel-width",
    defaultValue: DEFAULT_WIDTH,
    getInitialValueInEffect: false,
  });
  // A narrow screen's panel fills it, as wide as it ever was; the handle is hidden there too.
  const roomy = useMediaQuery(ROOMY, true, { getInitialValueInEffect: false });
  // While the edge is dragged the width follows the pointer; it is kept when let go.
  const [dragged, setDragged] = useState<number | null>(null);
  const { width: viewport } = useViewportSize();
  const widest = Math.max(MIN_WIDTH, (viewport || window.innerWidth) - PAGE_MARGIN);
  const clamp = (width: number) =>
    Math.round(Math.min(Math.max(width, MIN_WIDTH), widest));
  const width = clamp(dragged ?? stored);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragged(width);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragged === null) return;
    // The panel is held by its right edge, so its width is what lies right of the pointer.
    setDragged(clamp(window.innerWidth - event.clientX));
  };
  const onPointerUp = () => {
    if (dragged === null) return;
    setStored(dragged);
    setDragged(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") setStored(clamp(width + KEY_STEP));
    else if (event.key === "ArrowRight") setStored(clamp(width - KEY_STEP));
    else if (event.key === "Home") setStored(DEFAULT_WIDTH);
    else return;
    event.preventDefault();
  };

  return (
    <Drawer
      position="right"
      size={roomy ? width : DEFAULT_WIDTH}
      withOverlay={false}
      lockScroll={false}
      trapFocus={false}
      closeOnClickOutside={false}
      shadow="xl"
      padding="md"
      classNames={drawerClasses}
      {...props}
    >
      {children}
      <div
        className={handle}
        role="separator"
        aria-orientation="vertical"
        aria-label="Panel width"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={widest}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to widen; double-click for the usual width"
        data-dragging={dragged !== null || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setStored(DEFAULT_WIDTH)}
        onKeyDown={onKeyDown}
      />
    </Drawer>
  );
}
