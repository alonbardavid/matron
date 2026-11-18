import { useState } from "react";
import { Badge, Box, Group, Loader, Stack, Text, UnstyledButton } from "@mantine/core";
import type { AgentToolRunState } from "agents";
import { BUILD_LINE_PART, type BuildLine } from "@shared/contract/arch/sessions";
import { formatClock, formatDuration } from "../time";
import { useSeconds } from "../useNow";

const STATUS: Record<AgentToolRunState["status"], { label: string; color: string }> = {
  running: { label: "working", color: "blue" },
  completed: { label: "done", color: "green" },
  error: { label: "failed", color: "red" },
  aborted: { label: "stopped", color: "gray" },
  interrupted: { label: "interrupted", color: "orange" },
};

/** A tint of a theme colour, fainter than a light badge. */
function tint(color: string): { background: string; color: string } {
  return {
    background: `color-mix(in srgb, var(--mantine-color-${color}-light) 60%, transparent)`,
    color: `var(--mantine-color-${color}-light-color)`,
  };
}

const PLAIN = {
  background: "var(--mantine-color-default-hover)",
  color: "var(--mantine-color-dimmed)",
};

/** What a line is, said beside it: quiet, since it is good to know and no more. */
const KINDS: Record<
  BuildLine["kind"],
  { label: string; background: string; color: string }
> = {
  step: { label: "step", ...PLAIN },
  log: { label: "output", ...PLAIN },
  agent: { label: "agent", ...tint("blue") },
  thought: { label: "thinking", ...tint("grape") },
  tool: { label: "tool", ...PLAIN },
};

/** How much of the latest line shows while the run is collapsed. */
const TAIL_LINES = 3;
const LINE_HEIGHT = 18;

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
 * it is doing now, how long it took, and every line of what it did,
 * collapsed to the end of the latest.
 */
export function BuilderRunCard({ run }: { run: AgentToolRunState }) {
  const [expanded, setExpanded] = useState(false);
  const lines = linesOf(run);
  const first = lines[0];
  const last = lines[lines.length - 1];
  const status = STATUS[run.status];
  const mode =
    typeof run.display?.mode === "string" && run.display.mode !== "build"
      ? ` (${run.display.mode})`
      : "";
  const live = run.status === "running";
  // From its first line to its last; to this second while it still runs.
  const clock = useSeconds(live);
  const took =
    first && last ? (live ? Math.max(clock, last.ts) : last.ts) - first.ts : null;
  return (
    <Box
      mr="10%"
      pl="xs"
      style={{ borderLeft: "2px solid var(--mantine-color-default-border)" }}
    >
      <Group gap="xs" mb={4} wrap="nowrap">
        <Text size="xs" fw={600} c="dimmed" style={{ flexShrink: 0 }}>
          Builder{mode}
        </Text>
        <Badge size="xs" variant="light" color={status.color} style={{ flexShrink: 0 }}>
          {status.label}
        </Badge>
        {live && <Loader size={10} style={{ flexShrink: 0 }} />}
        {live && run.progress?.message && (
          <Text size="xs" c="dimmed" truncate>
            {run.progress.message}
          </Text>
        )}
        {took !== null && (
          <Text
            size="xs"
            c="dimmed"
            ml="auto"
            title={live ? "How long the builder has worked" : "How long the builder took"}
            style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
          >
            {formatDuration(took)}
          </Text>
        )}
      </Group>
      <Stack gap={4}>
        {expanded
          ? lines.map((line, index) => <Line key={`${line.ts}-${index}`} line={line} />)
          : last && <Line line={last} tail />}
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
        <UnstyledButton onClick={() => setExpanded((v) => !v)} mt={4}>
          <Text size="xs" c="dimmed" td="underline">
            {expanded ? "Show only the latest" : `Show all ${lines.length} steps`}
          </Text>
        </UnstyledButton>
      )}
    </Box>
  );
}

/** The last `count` lines of a text. */
function lastLines(text: string, count: number): string {
  return text.trimEnd().split("\n").slice(-count).join("\n");
}

/**
 * One line: when, what it is, and its text, each kind in its own voice.
 * With `tail`, only the end of it: the last lines that fit.
 */
function Line({ line, tail = false }: { line: BuildLine; tail?: boolean }) {
  const kind = KINDS[line.kind];
  const text = tail ? lastLines(line.text, TAIL_LINES) : line.text;
  return (
    <Group gap={6} align="flex-start" wrap="nowrap">
      <Text
        size="xs"
        c="dimmed"
        lh={`${LINE_HEIGHT}px`}
        style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
      >
        {formatClock(line.ts)}
      </Text>
      <Text
        component="span"
        fz={10}
        lh="16px"
        mt={1}
        w={54}
        ta="center"
        style={{
          flexShrink: 0,
          borderRadius: 4,
          background: kind.background,
          color: kind.color,
        }}
      >
        {kind.label}
      </Text>
      <Box
        flex={1}
        style={{
          minWidth: 0,
          ...(tail
            ? {
                // Clipped from the top, so what shows is the end.
                maxHeight: TAIL_LINES * LINE_HEIGHT,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
              }
            : {}),
        }}
      >
        <LineText kind={line.kind} text={text} tail={tail} />
      </Box>
    </Group>
  );
}

function LineText({
  kind,
  text,
  tail,
}: {
  kind: BuildLine["kind"];
  text: string;
  tail: boolean;
}) {
  const lh = `${LINE_HEIGHT}px`;
  const wrap = { wordBreak: "break-word" } as const;
  switch (kind) {
    case "log":
      return (
        <Text
          component="pre"
          size="xs"
          c="dimmed"
          ff="monospace"
          lh={lh}
          m={0}
          px={6}
          style={{
            // Collapsed, each line of output keeps to one row and is cut at its end.
            ...(tail
              ? { whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis" }
              : { ...wrap, whiteSpace: "pre-wrap" }),
            borderRadius: 4,
            background: "var(--mantine-color-default-hover)",
          }}
        >
          {text}
        </Text>
      );
    case "tool":
      return (
        <Text size="xs" c="dimmed" ff="monospace" lh={lh} style={wrap}>
          {text}
        </Text>
      );
    case "thought":
      return (
        <Text size="xs" c="dimmed" fs="italic" lh={lh} style={wrap}>
          {text}
        </Text>
      );
    case "agent":
      return (
        <Text size="xs" lh={lh} style={wrap}>
          {text}
        </Text>
      );
    case "step":
      return (
        <Text size="xs" c="dimmed" fw={600} lh={lh} style={wrap}>
          {text}
        </Text>
      );
  }
}
