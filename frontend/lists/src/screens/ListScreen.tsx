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
import { Link, useNavigate, useParams } from "react-router-dom";
import type { List, ListItem } from "@shared/contract/app/lists";
import { withBranch } from "@frontend/api/branch";
import { useHouseholdMembers } from "@frontend/auth/useHouseholdMembers";
import { useMe } from "@frontend/auth/useMe";
import { PeopleAvatars } from "@frontend/auth/widgets/PeopleAvatars";
import { EmptyState } from "@frontend/ds/EmptyState";
import { Form } from "@frontend/ds/forms/Form";
import {
  IconArrowLeft,
  IconChevronRight,
  IconDots,
  IconPin,
  IconPlus,
} from "@frontend/ds/icons";
import { usePinnedLists } from "../pins";
import { childrenOf, rowsOf } from "../tree";
import { useItemActions, useList, useListActions } from "../useLists";
import { ItemModal, type ItemValues } from "../widgets/ItemModal";
import { ItemTree } from "../widgets/ItemTree";
import { ListModal } from "../widgets/ListModal";

/** Whose list it is and who else sees it, in a line. */
function sharingLine(
  list: List,
  meId: string | undefined,
  nameOf: (id: string) => string,
) {
  const names = (ids: string[]) =>
    ids.length <= 2
      ? ids.map(nameOf).join(" and ")
      : `${ids.slice(0, -1).map(nameOf).join(", ")} and ${nameOf(ids[ids.length - 1]!)}`;
  if (list.creatorId !== meId) return `Shared with you by ${nameOf(list.creatorId)}`;
  return list.sharedWith.length > 0
    ? `Shared with ${names(list.sharedWith)}`
    : "Only you";
}

/** One list: its items as a tree to tick off, reorder and nest, and what was done, folded away. */
export function ListScreen() {
  const { id = "" } = useParams();
  const { list: current, isLoading } = useList(id);
  const { me } = useMe();
  const { nameOf } = useHouseholdMembers();
  const navigate = useNavigate();
  const itemActions = useItemActions();
  const listActions = useListActions();
  const { isPinned, toggle } = usePinnedLists();
  const [showDone, setShowDone] = useState(false);
  const [settings, setSettings] = useState(false);
  const [editing, setEditing] = useState<{
    item: ListItem | null;
    under: ListItem | null;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState(false);
  const [deleting, setDeleting] = useState<ListItem | null>(null);

  const items = useMemo(() => current?.items ?? [], [current]);
  const children = useMemo(() => childrenOf(items), [items]);
  const tops = children.get(null) ?? [];
  const openRows = useMemo(
    () =>
      rowsOf(
        tops.filter((item) => item.completedAt === null),
        children,
      ),
    [tops, children],
  );
  const doneRows = useMemo(
    () =>
      rowsOf(
        tops.filter((item) => item.completedAt !== null),
        children,
      ),
    [tops, children],
  );

  if (isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader size="sm" />
      </Group>
    );
  }
  if (!current) {
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

  const editable = current.myPermissions.includes("edit");
  const people = [current.creatorId, ...current.sharedWith];
  const pinned = isPinned(current.id);
  const save = (values: ItemValues) => {
    if (editing?.item) {
      itemActions.update(editing.item.id, values);
    } else {
      itemActions.add(current.id, { ...values, parentId: editing?.under?.id ?? null });
    }
  };

  const tree = (rows: typeof openRows, draggable: boolean) => (
    <ItemTree
      rows={rows}
      items={items}
      childMap={children}
      editable={editable}
      draggable={draggable}
      onToggle={(item, completed) => itemActions.update(item.id, { completed })}
      onOpen={(item) => setEditing({ item, under: null })}
      onAddUnder={(under) => setEditing({ item: null, under })}
      onMove={(item, placement) => itemActions.move(item.id, placement)}
      onDelete={setDeleting}
    />
  );

  return (
    <Container size="md" py="lg">
      <Stack gap="md">
        <Anchor
          component={Link}
          to={withBranch("/lists")}
          size="sm"
          fw={500}
          w="fit-content"
        >
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
                itemActions.add(current.id, { title });
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
            ? () => itemActions.remove(editing.item!.id)
            : undefined
        }
      />
      <Modal
        opened={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete item"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">Delete “{deleting?.title}” and everything under it?</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              color="red"
              onClick={() => {
                if (deleting) itemActions.remove(deleting.id);
                setDeleting(null);
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
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
              onClick={() => {
                listActions.remove(current.id);
                void navigate(withBranch("/lists"));
              }}
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
        onSave={(values) => listActions.update(current.id, values)}
      />
    </Container>
  );
}
