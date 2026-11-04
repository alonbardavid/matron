import { Drawer, type DrawerProps } from "@mantine/core";
import classes from "./SidePanel.module.css";

/** A chat-sized panel at the right edge, over the page without an overlay, its header on the shell's plum. */
export function SidePanel(props: DrawerProps) {
  return (
    <Drawer
      position="right"
      size={440}
      withOverlay={false}
      lockScroll={false}
      trapFocus={false}
      closeOnClickOutside={false}
      shadow="xl"
      padding="md"
      classNames={classes}
      {...props}
    />
  );
}
