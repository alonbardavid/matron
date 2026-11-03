import { Alert, Box, Group, Paper, Text } from "@mantine/core";
import type { ChatFrame } from "@shared/contract/arch/sessions";
import { Markdown } from "@frontend/ds/Markdown";
import { palette } from "@frontend/ds/palette";
import { formatStamp } from "../time";

interface ChatMessageProps {
  frame: ChatFrame;
}

export function ChatMessage({ frame }: ChatMessageProps) {
  const stamp = (
    <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
      {formatStamp(frame.ts)}
    </Text>
  );

  if (frame.type === "progress") {
    return (
      <Group gap={6} wrap="nowrap">
        {stamp}
        <Text size="xs" c="dimmed">
          {frame.text}
        </Text>
      </Group>
    );
  }

  if (frame.type === "error") {
    return (
      <Box>
        {stamp}
        <Alert color="red" variant="light" py="xs" fz="sm">
          {frame.text}
        </Alert>
      </Box>
    );
  }

  if (frame.role === "user") {
    return (
      <Box ml="15%" style={{ alignSelf: "flex-end" }}>
        <Group justify="flex-end" mb={2}>
          {stamp}
        </Group>
        <Paper bg={palette.bubbleUser} px="sm" py="xs">
          <Text size="sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {frame.text}
          </Text>
        </Paper>
      </Box>
    );
  }

  return (
    <Box mr="10%">
      <Group gap={6} mb={2}>
        <Text size="xs" c="dimmed" fw={600} tt="capitalize">
          {frame.role}
        </Text>
        {stamp}
      </Group>
      <Paper bg={palette.bubbleAgent} withBorder px="sm" py="xs">
        {frame.text && <Markdown text={frame.text} />}
      </Paper>
    </Box>
  );
}
