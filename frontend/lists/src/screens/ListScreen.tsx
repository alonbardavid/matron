import { useMemo, useState } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Container,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { List, ListItem } from "@shared/contract/app/lists";
import { withBranch } from "@frontend/api/branch";
import { orpc } from "@frontend/api/orpc";
import { useHouseholdMembers } from "@frontend/auth/useHouseholdMembers";
import { useMe } from "@frontend/auth/useMe";
import { PeopleAvatars } from "@frontend/auth/widgets/PeopleAvatars";
import { EmptyState } from "@frontend/ds/EmptyState";
import { Form } from "@frontend/ds/forms/Form";
import { IconArrowLeft, IconChevronRight, IconDots, IconPin, IconPlus } from "@frontend/ds/icons";
import { usePinnedLists } from "../pins";
import { applyMove, childrenOf, rowsOf, type Placement } from "../tree";
import { useItemActions, useList, useListActions, useLists } from "../useLists";
import { ItemModal, type ItemValues } from "../widgets/ItemModal";
import { ItemTree } from "../widgets/ItemTree";
import { ListModal } from "../widgets/ListModal";

/** Whose list it is and who else sees it, in a line. */
function sharingLine(list: List, meId: string | undefined, nameOf: (id: string) => string) {
  const names = (ids: string[]) =>
    ids.length <= 2
      ? ids.map(nameOf).join(" and ")
      : `${ids.slice(0, -1).map(nameOf).join(", ")} and ${nameOf(ids[ids.length - 1]!)}`;
  if (list.creatorId !== meId) return `Shared with you by ${nameOf(list.creatorId)}`;
  return list.sharedWith.length > 0 ? `Shared with ${names(list.sharedWith)}` : "Only you";
}

/** One list: its items as a tree to tick off, reorder and nest, and what was done, folded away. */
export function ListScreen() {
  const { id = "" } = useParams();
  const list = useList(id);
  const lists = useLists("");
  const { me } = useMe();
  const { nameOf } = useHouseholdMembers();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const itemActions = useItemActions();
  const listActions = useListActions();
  const { isPinned, toggle } = usePinnedLists();
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [settings, setSettings] = useState(false);
  const [editing, setEditing] = useState<{ item: ListItem | null; under: ListItem | null } | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState(false);

  const items = list.data?.items ?? [];
  const children = useMemo(() => childrenOf(items), [items]);
  const tops = children.get(null) ?? [];
  const openRows = useMemo(
    () => rowsOf(tops.filter((item) => item.completedAt === null), children, folded),
    [tops, children, folded],
  );
  const doneRows = useMemo(
    () => rowsOf(tops.filter((item) => item.completedAt !== null), children, folded),
    [tops, children, folded],
  );

  if (list.isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader size="sm" />
      </Group>
    );
  }
  if (!list.data) {
    return (
      <Container size="md" py="lg">
        <EmptyState
          title="This list is not here"
          description="It was removed, or it is no longer shared with you."
          action={
            <Button component={Link} to={withBranch("/lists")} variant="light">
              All lists
            </Button>
          }
        />
      </Container>
    );
  }

  const current = list.data;
  const editable = current.myPermissions.includes("edit");
  const people = [current.creatorId, ...current.sharedWith];
  const otherLists = (lists.data ?? [])
    .filter((other) => other.id !== current.id && other.myPermissions.includes("edit"))
    .map((other) => ({ id: other.id, name: other.name }));
  const pinned = isPinned(current.id);
  const listKey = orpc.lists.get.queryKey({ input: { id: current.id } });

  const move = (item: ListItem, placement: Placement, listId?: string) => {
    if (!listId) {
      // Shown where it was put at once; the server's answer replaces it.
      queryClient.setQueryData<List>(listKey, (old) =>
        old ? { ...old, items: applyMove(old.items, item.id, placement) } : old,
      );
    }
    itemActions.move.mutate({ id: item.id, ...placement, ...(listId && { listId }) });
  };

  const toggleDone = (item: ListItem, completed: boolean) => {
    queryClient.setQueryData<List>(listKey, (old) =>
      old
        ? {
            ...old,
            items: old.items.map((i) =>
              i.id === item.id ? { ...i, completedAt: completed ? Date.now() : null } : i,
            ),
          }
        : old,
    );
    itemActions.update.mutate({ id: item.id, completed });
  };

  const save = async (values: ItemValues) => {
    if (editing?.item) {
      await itemActions.update.mutateAsync({ id: editing.item.id, ...values });
    } else {
      await itemActions.add.mutateAsync({
        id: current.id,
        ...values,
        parentId: editing?.under?.id ?? null,
      });
    }
  };

  const tree = (rows: typeof openRows, draggable: boolean) => (
    <ItemTree
      rows={rows}
      items={items}
      childMap={children}
      editable={editable}
      draggable={draggable}
      folded={folded}
      onFold={(itemId) =>
        setFolded((prev) => {
          const next = new Set(prev);
          if (next.has(itemId)) next.delete(itemId);
          else next.add(itemId);
          return next;
        })
      }
      onToggle={toggleDone}
      onOpen={(item) => setEditing({ item, under: null })}
      onAddUnder={(under) => setEditing({ item: null, under })}
      onMove={move}
      otherLists={otherLists}
    />
  );

  return (
    <Container size="md" py="lg">
      <Stack gap="md">
        <Anchor component={Link} to={withBranch("/lists")} size="sm" fw={500} w="fit-content">
          <Group gap={4}>
            <IconArrowLeft size={16} />
            All lists
          </Group>
        </Anchor>

        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Group gap="sm" wrap="nowrap">
              <Box
                w={14}
                h={14}
                style={{ borderRadius: "50%", background: current.color, flex: "none" }}
              />
              <Title order={2}>{current.name}</Title>
            </Group>
            <Group gap="xs">
              {current.sharedWith.length > 0 && <PeopleAvatars ids={people} max={5} />}
              <Text size="sm" c="dimmed">
                {sharingLine(current, me?.id, nameOf)}
              </Text>
              {!editable && (
                <Badge size="sm" variant="light" color="gray">
                  View only
                </Badge>
              )}
            </Group>
          </Stack>
          <Group gap="xs" wrap="nowrap">
            <Button
              variant={pinned ? "light" : "default"}
              leftSection={<IconPin size={16} filled={pinned} />}
              aria-pressed={pinned}
              onClick={() => toggle(current.id)}
            >
              {pinned ? "Pinned" : "Pin"}
            </Button>
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="default" size="lg" aria-label="List options">
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => setSettings(true)}>
                  {current.myPermissions.includes("share") || editable
                    ? "Name, colour and sharing"
                    : "Sharing"}
                </Menu.Item>
                {current.creatorId === me?.id && (
                  <Menu.Item color="red" onClick={() => setRemoving(true)}>
                    Remove list
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>

        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          {openRows.length > 0 ? (
            tree(openRows, true)
          ) : (
            <Text size="sm" c="dimmed" p="md">
              {doneRows.length > 0 ? "All done." : "Nothing on this list yet."}
            </Text>
          )}
          {editable && (
            <Form
              onSubmit={() => {
                const title = draft.trim();
                if (!title) return;
                itemActions.add.mutate({ id: current.id, title });
                setDraft("");
              }}
            >
              <TextInput
                aria-label={`Add an item to ${current.name}`}
                placeholder="Add an item"
                variant="unstyled"
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                leftSection={<IconPlus size={16} />}
                px="xs"
                style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
              />
            </Form>
          )}
        </Paper>

        {doneRows.length > 0 && (
          <Stack gap="xs" component="section" aria-label="Completed">
            <UnstyledButton
              onClick={() => setShowDone((shown) => !shown)}
              aria-expanded={showDone}
              w="fit-content"
            >
              <Group gap={6}>
                <Box
                  component="span"
                  style={{
                    display: "inline-flex",
                    transform: showDone ? "rotate(90deg)" : undefined,
                    transition: "transform 120ms ease",
                  }}
                >
                  <IconChevronRight size={14} />
                </Box>
                <Text size="sm" fw={600} c="dimmed">
                  {doneRows.filter((row) => row.depth === 0).length} completed
                </Text>
              </Group>
            </UnstyledButton>
            {showDone && (
              <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
                {tree(doneRows, false)}
              </Paper>
            )}
          </Stack>
        )}
      </Stack>

      <ItemModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        item={editing?.item ?? null}
        under={editing?.under?.title ?? null}
        people={people}
        editable={editable}
        onSave={save}
        onRemove={
          editing?.item
            ? async () => {
                await itemActions.remove.mutateAsync({ id: editing.item!.id });
              }
            : undefined
        }
      />
      <Modal
        opened={removing}
        onClose={() => setRemoving(false)}
        title="Remove list"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Remove “{current.name}” and all its items, for everyone it is shared with?
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRemoving(false)}>
              Keep it
            </Button>
            <Button
              color="red"
              loading={listActions.remove.isPending}
              onClick={() =>
                listActions.remove.mutate(
                  { id: current.id },
                  { onSuccess: () => void navigate(withBranch("/lists")) },
                )
              }
            >
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>
      <ListModal
        opened={settings}
        onClose={() => setSettings(false)}
        list={current}
        onSave={async (values) => {
          await listActions.update.mutateAsync({ id: current.id, ...values });
        }}
      />
    </Container>
  );
}
