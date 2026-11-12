import { SegmentedControl } from "@mantine/core";
import type { DiffLayout } from "../layout";

const LAYOUTS = [
  { value: "unified", label: "Unified" },
  { value: "split", label: "Split" },
];

/** Unified or split, for the diffs beside it. */
export function LayoutSwitch({
  layout,
  onChange,
}: {
  layout: DiffLayout;
  onChange: (layout: DiffLayout) => void;
}) {
  return (
    <SegmentedControl
      size="xs"
      aria-label="Diff layout"
      value={layout}
      onChange={(value) => onChange(value as DiffLayout)}
      data={LAYOUTS}
    />
  );
}
