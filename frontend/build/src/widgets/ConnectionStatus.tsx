import { Group, Text } from "@mantine/core";
import type { SocketStatus } from "@frontend/api/socket";

const LABELS: Record<SocketStatus, { text: string; color: string }> = {
  connecting: { text: "Connecting", color: "yellow" },
  open: { text: "Connected", color: "sage" },
  closed: { text: "Disconnected", color: "red" },
};

export function ConnectionStatus({ status }: { status: SocketStatus }) {
  const { text, color } = LABELS[status];
  return (
    <Group gap={6} wrap="nowrap">
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          background: `var(--mantine-color-${color}-6)`,
          display: "inline-block",
        }}
      />
      <Text size="xs" c="dimmed">
        {text}
      </Text>
    </Group>
  );
}
