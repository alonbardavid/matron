import { Box, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useMemo, useState, type ReactNode } from "react";
import { markKey } from "../diff";
import type { ReviewModel } from "../model";
import type { Viewed } from "../viewed";
import { DiffView } from "./DiffView";
import { MarkButton, markState } from "./Marks";
import { plural, ViewedIcon } from "./Progress";
import type { DiffLayout } from "../layout";
import classes from "./review.module.css";

interface FilesTabProps {
  model: ReviewModel;
  viewed: Viewed;
  layout: DiffLayout;
  selected: string | null;
  onSelect: (path: string) => void;
}

const STATUS_LABELS = { added: "added", modified: "", deleted: "deleted" } as const;

/** Review by file: the changed files as a tree on the left, one file's diff at a time. */
export function FilesTab({ model, viewed, layout, selected, onSelect }: FilesTabProps) {
  const wide = useMediaQuery("(min-width: 62em)");
  const [filter, setFilter] = useState("");
  const path = selected && model.files.has(selected) ? selected : model.paths[0];
  const needle = filter.trim().toLowerCase();
  const shown = useMemo(
    () => model.paths.filter((p) => p.toLowerCase().includes(needle)),
    [model.paths, needle],
  );
  if (!path) {
    return (
      <Text c="dimmed" size="sm">
        Nothing changed on this branch.
      </Text>
    );
  }
  const file = model.files.get(path)!;
  const keys = file.changes.map((change) => markKey(path, change));
  const done = viewed.count(keys);
  const next = model.paths[model.paths.indexOf(path) + 1];

  return (
    <Group align="flex-start" gap="lg" wrap={wide ? "nowrap" : "wrap"}>
      <Paper
        component="aside"
        aria-label="Changed files"
        withBorder
        p={8}
        w={wide ? 300 : "100%"}
        className={wide ? classes.aside : undefined}
        style={{ flexShrink: 0 }}
      >
        <Stack gap={6}>
          <TextInput
            size="xs"
            placeholder="Filter changed files"
            aria-label="Filter changed files"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
          />
          <nav aria-label="File tree">
            {treeRows(shown, (p, name, depth) => {
              const fileKeys = model.files
                .get(p)!
                .changes.map((change) => markKey(p, change));
              return (
                <button
                  key={p}
                  type="button"
                  aria-current={p === path ? "true" : undefined}
                  className={`${classes.item} ${p === path ? classes.current : ""}`}
                  style={{ padding: "3px 8px", paddingLeft: 8 + depth * 14 }}
                  onClick={() => onSelect(p)}
                >
                  <Group gap={6} wrap="nowrap">
                    <ViewedIcon done={viewed.count(fileKeys)} total={fileKeys.length} />
                    <Text span ff="monospace" fz={12.5} truncate>
                      {name}
                    </Text>
                  </Group>
                </button>
              );
            })}
          </nav>
        </Stack>
      </Paper>

      <Stack gap="md" style={{ flex: 1, minWidth: 0 }}>
        <Paper component="article" withBorder style={{ overflow: "hidden" }}>
          <Group
            justify="space-between"
            px="md"
            py="sm"
            gap="xs"
            style={{ borderBottom: "1px solid var(--matron-border)" }}
          >
            <Group gap="xs" style={{ minWidth: 0 }}>
              <Text ff="monospace" fz="sm" fw={500} style={{ wordBreak: "break-all" }}>
                {path}
              </Text>
              {STATUS_LABELS[file.file.status] && (
                <Text size="xs" c="dimmed">
                  {STATUS_LABELS[file.file.status]}
                </Text>
              )}
              {file.added > 0 && (
                <Text size="xs" c="green.7" ff="monospace">
                  +{file.added}
                </Text>
              )}
              {file.removed > 0 && (
                <Text size="xs" c="red.7" ff="monospace">
                  −{file.removed}
                </Text>
              )}
            </Group>
            <Group gap="sm">
              <Text size="xs" c="dimmed">
                {plural(keys.length, "change")} · {done} viewed
              </Text>
              <MarkButton
                state={markState(done, keys.length)}
                label="Viewed"
                onToggle={() => viewed.setViewed(keys, done < keys.length)}
              >
                Viewed
              </MarkButton>
            </Group>
          </Group>
          <Box style={{ overflowX: "auto" }}>
            <DiffView key={path} model={file} viewed={viewed} layout={layout} />
          </Box>
        </Paper>
        {next && (
          <Group justify="flex-end" gap="sm">
            <Text size="sm" c="dimmed">
              Next file
            </Text>
            <Button variant="default" onClick={() => onSelect(next)}>
              <Text span ff="monospace" fz={12}>
                {next.slice(next.lastIndexOf("/") + 1)}
              </Text>
              &nbsp;→
            </Button>
          </Group>
        )}
      </Stack>
    </Group>
  );
}

/** The paths as a tree: a folder row wherever a directory starts, each file indented under it. */
function treeRows(
  paths: string[],
  fileRow: (path: string, name: string, depth: number) => ReactNode,
): ReactNode[] {
  const rows: ReactNode[] = [];
  let open: string[] = [];
  for (const path of paths) {
    const parts = path.split("/");
    const dirs = parts.slice(0, -1);
    let same = 0;
    while (same < dirs.length && same < open.length && dirs[same] === open[same]) same++;
    for (let depth = same; depth < dirs.length; depth++) {
      rows.push(
        <Text
          key={`dir:${dirs.slice(0, depth + 1).join("/")}`}
          ff="monospace"
          fz={12.5}
          c="dimmed"
          py={3}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {dirs[depth]}/
        </Text>,
      );
    }
    open = dirs;
    rows.push(fileRow(path, parts[parts.length - 1]!, dirs.length));
  }
  return rows;
}
