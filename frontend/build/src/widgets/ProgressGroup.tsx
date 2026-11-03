import { useState } from "react";
import { Box, Group, Loader, Stack, Text, UnstyledButton } from "@mantine/core";
import type { ChatFrame } from "@shared/contract/arch/sessions";
import { formatStamp } from "../time";

type ProgressFrame = ChatFrame & { type: "progress" };

interface ProgressGroupProps {
  frames: ProgressFrame[];
  /** The planner or builder is still working on the last step: show a spinner. */
  live: boolean;
}

/**
 * A run of what the planner or builder was doing: collapsed it shows the latest
 * line, expanded every line, each with its time.
 */
export function ProgressGroup({ frames, live }: ProgressGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const last = frames[frames.length - 1];
  if (!last) return null;
  const shown = expanded ? frames : [last];
  return (
    <Box
      mr="10%"
      pl="xs"
      style={{ borderLeft: "2px solid var(--mantine-color-default-border)" }}
    >
      <Stack gap={2}>
        {shown.map((frame) => (
          <ProgressLine key={frame.id} frame={frame} spinner={live && frame === last} />
        ))}
      </Stack>
      {frames.length > 1 && (
        <UnstyledButton onClick={() => setExpanded((v) => !v)} mt={2}>
          <Text size="xs" c="dimmed" td="underline">
            {expanded ? "Show only the latest" : `Show all ${frames.length} steps`}
          </Text>
        </UnstyledButton>
      )}
    </Box>
  );
}

function ProgressLine({ frame, spinner }: { frame: ProgressFrame; spinner: boolean }) {
  return (
    <Group gap={6} align="flex-start" wrap="nowrap">
      <Text
        size="xs"
        c="dimmed"
        style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
      >
        {formatStamp(frame.ts)}
      </Text>
      {spinner && <Loader size={10} mt={4} />}
      {frame.kind === "log" ? (
        <Text
          component="pre"
          size="xs"
          c="dimmed"
          ff="monospace"
          m={0}
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", minWidth: 0 }}
        >
          {frame.text}
        </Text>
      ) : (
        <Text size="xs" c="dimmed" style={{ wordBreak: "break-word", minWidth: 0 }}>
          {frame.text}
        </Text>
      )}
    </Group>
  );
}
