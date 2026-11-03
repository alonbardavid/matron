import { Paper, type PaperProps } from "@mantine/core";
import type { ReactNode } from "react";

export function Card({ children, ...props }: PaperProps & { children: ReactNode }) {
  return (
    <Paper withBorder p="md" {...props}>
      {children}
    </Paper>
  );
}
