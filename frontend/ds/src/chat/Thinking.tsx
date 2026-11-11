import { Group, Loader, Text } from "@mantine/core";

/** The agent has the message and is working on it; `status` says what it is up to. */
export function Thinking({ status = "thinking" }: { status?: string }) {
  return (
    <Group gap="xs">
      <Loader size={12} />
      <Text size="xs" c="dimmed">
        {status}
      </Text>
    </Group>
  );
}
