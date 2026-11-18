import { useState } from "react";
import { Button, Group, Loader, Stack, Text, TextInput } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useNavigate } from "react-router-dom";
import type { ListSummary } from "@shared/contract/app/lists";
import { withBranch } from "@frontend/api/branch";
import { EmptyState } from "@frontend/ds/EmptyState";
import { IconPlus, IconSearch } from "@frontend/ds/icons";
import { Page } from "@frontend/ds/Page";
import { usePinnedLists } from "../pins";
import { useListActions, useLists } from "../useLists";
import { ListCard } from "../widgets/ListCard";
import classes from "../widgets/ListCard.module.css";
import { ListModal } from "../widgets/ListModal";

/** The caller's lists as cards: those pinned on this device first, a search over names and items. */
export function ListsScreen() {
  const [search, setSearch] = useState("");
  const [q] = useDebouncedValue(search, 200);
  const lists = useLists(q);
  const { create } = useListActions();
  const { isPinned, toggle } = usePinnedLists();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const all = lists.data ?? [];
  const pinned = all.filter((list) => isPinned(list.id));
  const others = all.filter((list) => !isPinned(list.id));

  const grid = (items: ListSummary[]) => (
    <div className={classes.grid}>
      {items.map((list) => (
        <ListCard
          key={list.id}
          list={list}
          pinned={isPinned(list.id)}
          onTogglePin={() => toggle(list.id)}
        />
      ))}
    </div>
  );

  return (
    <Page
      title="Lists"
      description="The household's lists, and your own."
      size="lg"
      action={
        <Button leftSection={<IconPlus />} onClick={() => setCreating(true)}>
          New list
        </Button>
      }
    >
      <TextInput
        type="search"
        aria-label="Search lists"
        placeholder="Search lists and items"
        leftSection={<IconSearch size={18} />}
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
        maw={560}
      />
      {lists.isLoading ? (
        <Group justify="center" p="xl">
          <Loader size="sm" />
        </Group>
      ) : all.length === 0 ? (
        q.trim() ? (
          <Text c="dimmed" size="sm">
            No list or item matches “{q.trim()}”.
          </Text>
        ) : (
          <EmptyState
            title="No lists yet"
            description="Make a list for the shopping, the chores, or anything else."
          />
        )
      ) : (
        <Stack gap="lg">
          {pinned.length > 0 && (
            <Stack gap="xs" component="section" aria-label="Pinned">
              <Group gap={6} align="baseline">
                <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts="0.06em">
                  Pinned
                </Text>
                <Text size="xs" c="dimmed">
                  on this device
                </Text>
              </Group>
              {grid(pinned)}
            </Stack>
          )}
          {others.length > 0 && (
            <Stack gap="xs" component="section" aria-label="Others">
              {pinned.length > 0 && (
                <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts="0.06em">
                  Others
                </Text>
              )}
              {grid(others)}
            </Stack>
          )}
        </Stack>
      )}
      <ListModal
        opened={creating}
        onClose={() => setCreating(false)}
        list={null}
        onSave={async (values) => {
          const made = await create.mutateAsync(values);
          void navigate(withBranch(`/lists/${made.id}`));
        }}
      />
    </Page>
  );
}
