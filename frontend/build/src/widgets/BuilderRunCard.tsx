import { useState } from "react";
import { Badge, Box, Group, Loader, Stack, Text, UnstyledButton } from "@mantine/core";
import type { AgentToolRunState } from "agents";
import { BUILD_LINE_PART, type BuildLine } from "@shared/contract/arch/sessions";
import { formatStamp } from "../time";

const STATUS: Record<AgentToolRunState["status"], { label: string; color: string }> = {
  running: { label: "working", color: "blue" },
  completed: { label: "done", color: "green" },
  error: { label: "failed", color: "red" },
  aborted: { label: "stopped", color: "gray" },
  interrupted: { label: "interrupted", color: "orange" },
};

/** The builder's lines as its run streamed them, oldest first. */
function linesOf(run: AgentToolRunState): BuildLine[] {
  return run.parts.flatMap((part) => {
    if (part.type !== BUILD_LINE_PART) return [];
    const data = (part as { data?: unknown }).data;
    return isLine(data) ? [data] : [];
  });
}

function isLine(value: unknown): value is BuildLine {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as BuildLine).text === "string" &&
    typeof (value as BuildLine).ts === "number"
  );
}

/**
 * One run of the builder, beside the planner's reply that started it: what
 * it is doing now, and every line of what it did, collapsed to the latest.
 */
export function BuilderRunCard({ run }: { run: AgentToolRunState }) {
  const [expanded, setExpanded] = useState(false);
  const lines = linesOf(run);
  const last = lines[lines.length - 1];
  const shown = expanded ? lines : last ? [last] : [];
  const status = STATUS[run.status];
  const mode =
    typeof run.display?.mode === "string" && run.display.mode !== "build"
      ? ` (${run.display.mode})`
      : "";
  const live = run.status === "running";
  return (
    <Box
      mr="10%"
      pl="xs"
      style={{ borderLeft: "2px solid var(--mantine-color-default-border)" }}
    >
      <Group gap="xs" mb={2} wrap="nowrap">
        <Text size="xs" fw={600} c="dimmed">
          Builder{mode}
        </Text>
        <Badge size="xs" variant="light" color={status.color}>
          {status.label}
        </Badge>
        {live && <Loader size={10} />}
        {live && run.progress?.message && (
          <Text size="xs" c="dimmed" truncate>
            {run.progress.message}
          </Text>
        )}
      </Group>
      <Stack gap={2}>
        {shown.map((line, index) => (
          <Line key={`${line.ts}-${index}`} line={line} />
        ))}
        {run.status === "error" && run.error && (
          <Text size="xs" c="red">
            {run.error}
          </Text>
        )}
        {run.status === "interrupted" && run.error && (
          <Text size="xs" c="orange">
            {run.error}
          </Text>
        )}
      </Stack>
      {lines.length > 1 && (
        <UnstyledButton onClick={() => setExpanded((v) => !v)} mt={2}>
          <Text size="xs" c="dimmed" td="underline">
            {expanded ? "Show only the latest" : `Show all ${lines.length} steps`}
          </Text>
        </UnstyledButton>
      )}
    </Box>
  );
}

function Line({ line }: { line: BuildLine }) {
  const prefix =
    line.kind === "agent" ? "agent: " : line.kind === "thought" ? "thinking: " : "";
  return (
    <Group gap={6} align="flex-start" wrap="nowrap">
      <Text
        size="xs"
        c="dimmed"
        style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
      >
        {formatStamp(line.ts)}
      </Text>
      {line.kind === "log" ? (
        <Text
          component="pre"
          size="xs"
          c="dimmed"
          ff="monospace"
          m={0}
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", minWidth: 0 }}
        >
          {line.text}
        </Text>
      ) : (
        <Text size="xs" c="dimmed" style={{ wordBreak: "break-word", minWidth: 0 }}>
          {prefix}
          {line.text}
        </Text>
      )}
    </Group>
  );
}
