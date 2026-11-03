import { createTheme, type MantineColorsTuple } from "@mantine/core";

const clay: MantineColorsTuple = [
  "#fdf3ee",
  "#f6e4da",
  "#eec7b3",
  "#e6a889",
  "#df8e66",
  "#db7d50",
  "#d97444",
  "#c06236",
  "#ab562e",
  "#954824",
];

const sage: MantineColorsTuple = [
  "#f1f7f1",
  "#e2ebe2",
  "#c3d5c3",
  "#a1bea2",
  "#85aa86",
  "#729e74",
  "#67986a",
  "#56845a",
  "#4b764f",
  "#3c6641",
];

export const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const theme = createTheme({
  primaryColor: "clay",
  primaryShade: { light: 6, dark: 5 },
  colors: { clay, sage },
  fontFamily: FONT_STACK,
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  headings: { fontFamily: FONT_STACK, fontWeight: "650" },
  defaultRadius: "md",
  cursorType: "pointer",
  components: {
    Paper: { defaultProps: { radius: "md" } },
    Button: { defaultProps: { radius: "md" } },
    Badge: { defaultProps: { radius: "sm" } },
  },
});
