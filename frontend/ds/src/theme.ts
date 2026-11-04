import {
  createTheme,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from "@mantine/core";

/** The household's magenta: shade 6 is the primary, 7 hover, 8 pressed, 0 the soft tint. */
const rose: MantineColorsTuple = [
  "#fce7f2",
  "#f8cfe3",
  "#f2a9cc",
  "#ea7fb2",
  "#e05598",
  "#cc2a82",
  "#b9086e",
  "#96055a",
  "#6e0441",
  "#4d0230",
];

/** The shell's plum, for the navigation, panel headers and the Build button. */
const plum: MantineColorsTuple = [
  "#f3e8ef",
  "#e4cbdb",
  "#c9a1ba",
  "#ad7799",
  "#8e4f76",
  "#3d1030",
  "#2b0b1f",
  "#1f0816",
  "#14050f",
  "#0a0308",
];

/** Success: shade 4 is the "connected" dot, 6 the text on its tint. */
const sage: MantineColorsTuple = [
  "#e3f2e7",
  "#c9e6d2",
  "#a7d6b6",
  "#82c498",
  "#5cc98a",
  "#3fa86b",
  "#1f6b3a",
  "#1a5c32",
  "#154d2a",
  "#0f3a1f",
];

/** Warm neutrals: backgrounds and borders up to shade 4, text from 6. */
const gray: MantineColorsTuple = [
  "#f7f4f6",
  "#efe8ec",
  "#e9e2e6",
  "#e2d9de",
  "#d9cfd5",
  "#a89aa3",
  "#6f6169",
  "#4a3e45",
  "#332830",
  "#241b21",
];

export const FONT_STACK =
  '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const theme = createTheme({
  primaryColor: "rose",
  primaryShade: { light: 6, dark: 5 },
  colors: { rose, plum, sage, gray },
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

/** The light scheme's semantic colours, from the brand tokens in brand.css. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    "--mantine-color-text": "var(--matron-text)",
    "--mantine-color-dimmed": "var(--matron-text-muted)",
    "--mantine-color-default-border": "var(--matron-border-strong)",
    "--mantine-color-rose-light": "var(--matron-primary-tint)",
    "--mantine-color-rose-light-hover": "#f8cfe3",
    "--mantine-color-rose-light-color": "var(--matron-on-primary-tint)",
    "--mantine-primary-color-light": "var(--matron-primary-tint)",
    "--mantine-primary-color-light-hover": "#f8cfe3",
    "--mantine-primary-color-light-color": "var(--matron-on-primary-tint)",
    "--mantine-color-sage-light": "var(--matron-success-bg)",
    "--mantine-color-sage-light-color": "var(--matron-success-fg)",
  },
  dark: {},
});
