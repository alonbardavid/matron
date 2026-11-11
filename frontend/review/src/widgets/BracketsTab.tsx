import {
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Markdown } from "@frontend/ds/Markdown";
import { changesIn, markKey } from "../diff";
import type { DiffLayouts } from "../layout";
import type { ReviewModel, ShownBracket } from "../model";
import type { Viewed } from "../viewed";
import { DiffView } from "./DiffView";
import { LayoutSwitch } from "./LayoutSwitch";
import { MarkButton, markState } from "./Marks";
import { leftLabel, plural, ViewedBar } from "./Progress";
import classes from "./review.module.css";

interface BracketsTabProps {
  model: ReviewModel;
  viewed: Viewed;
  layouts: DiffLayouts;
  selected: number;
  onSelect: (index: number) => void;
  onOpenFile: (path: string) => void;
}

const KIND_LABELS: Record<ShownBracket["kind"], string> = {
  flow: "Flow",
  schema: "Schema",
  refactor: "Refactor",
  move: "Move",
  tests: "Tests",
  config: "Config",
  docs: "Docs",
  other: "Other",
  unbracketed: "Ungrouped",
};

function fileCount(bracket: ShownBracket): number {
  return new Set(bracket.ranges.map((range) => range.path)).size;
}

/** The guided read: the builder's brackets on the left, one at a time on the right, range by range. */
export function BracketsTab({
  model,
  viewed,
  layouts,
  selected,
  onSelect,
  onOpenFile,
}: BracketsTabProps) {
  const wide = useMediaQuery("(min-width: 62em)");
  const index = Math.min(Math.max(selected, 0), model.brackets.length - 1);
  const bracket = model.brackets[index];
  if (!bracket) {
    return (
      <Text c="dimmed" size="sm">
        Nothing changed on this branch.
      </Text>
    );
  }
  const next = model.brackets[index + 1];

  return (
    <Group align="flex-start" gap="lg" wrap={wide ? "nowrap" : "wrap"}>
      <Paper
        component="nav"
        aria-label="Brackets"
        withBorder
        p={6}
        w={wide ? 300 : "100%"}
        className={wide ? classes.aside : undefined}
        style={{ flexShrink: 0 }}
      >
        <Stack gap={2}>
          {model.brackets.map((item, i) => {
            const done = viewed.count(item.keys);
            return (
              <button
                key={`${i}-${item.title}`}
                type="button"
                aria-current={i === index ? "true" : undefined}
                className={`${classes.item} ${i === index ? classes.current : ""}`}
                onClick={() => onSelect(i)}
              >
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <span className={classes.kind}>{KIND_LABELS[item.kind]}</span>
                  <span className={classes.kind}>
                    {leftLabel(done, item.keys.length)}
                  </span>
                </Group>
                <Text size="sm" fw={500} my={4}>
                  {item.title}
                </Text>
                <ViewedBar done={done} total={item.keys.length} />
                <Text size="xs" c="dimmed" mt={4}>
                  {plural(item.ranges.length, "range")} ·{" "}
                  {plural(fileCount(item), "file")}
                </Text>
              </button>
            );
          })}
        </Stack>
      </Paper>

      <Stack gap="md" style={{ flex: 1, minWidth: 0 }}>
        <BracketHeader bracket={bracket} viewed={viewed} />
        {bracket.ranges.map((range, i) => {
          const file = model.files.get(range.path);
          const keys = file
            ? changesIn(file, range.start, range.end).map((c) => markKey(range.path, c))
            : [];
          const done = viewed.count(keys);
          const layoutKey = `range:${range.path}:${range.start}-${range.end}`;
          const layout = layouts.layoutOf(layoutKey);
          return (
            <Group
              key={`${range.path}:${range.start}-${range.end}`}
              align="flex-start"
              gap="sm"
              wrap="nowrap"
            >
              {wide && <div className={classes.step}>{i + 1}</div>}
              <Paper withBorder style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                <Group
                  justify="space-between"
                  px="sm"
                  py={8}
                  gap="xs"
                  style={{ borderBottom: "1px solid var(--matron-border)" }}
                >
                  <Group gap="xs" style={{ minWidth: 0 }}>
                    <Anchor
                      component="button"
                      ff="monospace"
                      fz="sm"
                      c="inherit"
                      onClick={() => onOpenFile(range.path)}
                    >
                      {range.path}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      lines {range.start}–{range.end}
                    </Text>
                  </Group>
                  <Group gap="sm">
                    {file && (
                      <LayoutSwitch
                        layout={layout}
                        onChange={(next) => layouts.setLayout(layoutKey, next)}
                      />
                    )}
                    {keys.length > 0 && (
                      <MarkButton
                        state={markState(done, keys.length)}
                        label={`Viewed: ${range.path} lines ${range.start}–${range.end}`}
                        onToggle={() => viewed.setViewed(keys, done < keys.length)}
                      >
                        Viewed
                      </MarkButton>
                    )}
                  </Group>
                </Group>
                {range.note && (
                  <Text size="sm" px="sm" py={6} c="dimmed">
                    {range.note}
                  </Text>
                )}
                {file ? (
                  <Box style={{ overflowX: "auto" }}>
                    <DiffView
                      model={file}
                      focus={range}
                      viewed={viewed}
                      layout={layout}
                    />
                  </Box>
                ) : (
                  <Text size="sm" c="dimmed" p="sm">
                    This file did not change on the branch.
                  </Text>
                )}
              </Paper>
            </Group>
          );
        })}
        {next && (
          <Group justify="flex-end" gap="sm">
            <Text size="sm" c="dimmed">
              Next bracket
            </Text>
            <Button variant="default" onClick={() => onSelect(index + 1)}>
              {next.title} →
            </Button>
          </Group>
        )}
      </Stack>
    </Group>
  );
}

/** The bracket's kind, title and description, and its progress. */
function BracketHeader({ bracket, viewed }: { bracket: ShownBracket; viewed: Viewed }) {
  const done = viewed.count(bracket.keys);
  const total = bracket.keys.length;
  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Badge variant="default" radius="sm" tt="none">
            {KIND_LABELS[bracket.kind]}
          </Badge>
          <Text size="xs" c="dimmed">
            {plural(bracket.ranges.length, "range")} ·{" "}
            {plural(fileCount(bracket), "file")}
          </Text>
        </Group>
        <Title order={3}>{bracket.title}</Title>
        {bracket.description && <Markdown text={bracket.description} />}
        <Group gap="md" wrap="wrap">
          <Box w={220}>
            <ViewedBar done={done} total={total} />
          </Box>
          <Text size="sm" c="dimmed" style={{ flex: 1 }}>
            {plural(total, "change")} · {done} viewed
          </Text>
          {total > 0 && (
            <Button
              color="sage"
              variant={done >= total ? "light" : "filled"}
              onClick={() => viewed.setViewed(bracket.keys, done < total)}
            >
              {done >= total ? "Bracket viewed" : `Mark bracket viewed (${total - done})`}
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}
