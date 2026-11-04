import { Group, Text } from "@mantine/core";
import type { SocketStatus } from "@frontend/api/socket";
import { palette } from "@frontend/ds/palette";

const LABELS: Record<SocketStatus, { text: string; color: string }> = {
  connecting: { text: "Connecting", color: "var(--mantine-color-yellow-6)" },
  open: { text: "Connected", color: palette.connected },
  closed: { text: "Disconnected", color: "var(--mantine-color-red-6)" },
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
          background: color,
          display: "inline-block",
        }}
      />
      <Text size="xs" c="dimmed">
        {text}
      </Text>
    </Group>
  );
}
