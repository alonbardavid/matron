import { Container, Group, Stack, Text, Title, type ContainerProps } from "@mantine/core";
import type { ReactNode } from "react";

interface PageProps {
  title: string;
  description?: string;
  action?: ReactNode;
  size?: ContainerProps["size"];
  children: ReactNode;
}

export function Page({ title, description, action, size = "sm", children }: PageProps) {
  return (
    <Container size={size} py="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div style={{ minWidth: 0, flex: "1 1 220px" }}>
            {/* A phone's top bar already names the page. */}
            <Title order={2} visibleFrom="sm">
              {title}
            </Title>
            {description && (
              <Text c="dimmed" size="sm" mt={4}>
                {description}
              </Text>
            )}
          </div>
          {action}
        </Group>
        {children}
      </Stack>
    </Container>
  );
}
