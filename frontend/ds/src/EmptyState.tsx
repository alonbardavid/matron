import { Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Stack align="center" gap="xs" py="xl" ta="center">
      <Text fw={600}>{title}</Text>
      {description && (
        <Text c="dimmed" size="sm" maw={360}>
          {description}
        </Text>
      )}
      {action}
    </Stack>
  );
}
