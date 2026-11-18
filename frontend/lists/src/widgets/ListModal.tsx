import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  ColorSwatch,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  LIST_COLORS,
  type List,
  type ListCreate,
  type SharePermission,
} from "@shared/contract/app/lists";
import { useHouseholdMembers } from "@frontend/auth/useHouseholdMembers";
import { useMe } from "@frontend/auth/useMe";
import { PeoplePicker } from "@frontend/auth/widgets/PeoplePicker";
import { UserAvatar } from "@frontend/auth/widgets/UserAvatar";
import { Form } from "@frontend/ds/forms/Form";
import { IconCheck } from "@frontend/ds/icons";

type Values = Required<Pick<ListCreate, "name" | "color" | "sharedWith" | "permissions">>;

function valuesOf(list: List | null): Values {
  return list
    ? {
        name: list.name,
        color: (LIST_COLORS as readonly string[]).includes(list.color)
          ? (list.color as Values["color"])
          : LIST_COLORS[0],
        sharedWith: list.sharedWith,
        permissions: list.permissions,
      }
    : { name: "", color: LIST_COLORS[0], sharedWith: [], permissions: {} };
}

interface ListModalProps {
  opened: boolean;
  onClose: () => void;
  /** The list being changed, or null for a new one. */
  list: List | null;
  onSave: (values: Values) => Promise<void>;
}

/**
 * A new list, or a list's name, colour and sharing. What can be changed
 * follows what the caller may do: edit for the name, the colour and who may
 * edit; share for who it is shared with and who may share it.
 */
export function ListModal({ opened, onClose, list, onSave }: ListModalProps) {
  const { me } = useMe();
  const [values, setValues] = useState<Values>(valuesOf(list));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (opened) {
      setValues(valuesOf(list));
      setError(null);
    }
  }, [opened, list]);

  const mine = list?.myPermissions ?? ["view", "share", "edit"];
  const canEdit = mine.includes("edit");
  const canShare = mine.includes("share");
  const creatorId = list?.creatorId ?? me?.id ?? "";
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    if (!values.name.trim()) {
      setError("Give the list a name");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...values, name: values.name.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the list");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={list ? "List settings" : "New list"}
      centered
    >
      <Form onSubmit={() => void save()}>
        <TextInput
          label="Name"
          value={values.name}
          onChange={(e) => set("name", e.currentTarget.value)}
          error={error && !values.name.trim() ? error : undefined}
          disabled={!canEdit}
          data-autofocus
        />
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            Colour
          </Text>
          <Group gap="xs" role="radiogroup" aria-label="Colour">
            {LIST_COLORS.map((color) => (
              <UnstyledButton
                key={color}
                role="radio"
                aria-checked={values.color === color}
                aria-label={color}
                disabled={!canEdit}
                onClick={() => set("color", color)}
              >
                <ColorSwatch color={color} size={28}>
                  {values.color === color && <IconCheck size={14} color="white" />}
                </ColorSwatch>
              </UnstyledButton>
            ))}
          </Group>
        </Stack>
        <PeoplePicker
          label="Shared with"
          placeholder="Only you"
          value={values.sharedWith}
          onChange={(ids) => set("sharedWith", ids)}
          exclude={[creatorId]}
          disabled={!canShare}
        />
        <ListSharing
          people={values.sharedWith}
          value={values.permissions}
          canEdit={canEdit}
          canShare={canShare}
          onChange={(permissions) => set("permissions", permissions)}
        />
        {error && values.name.trim() && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}
        <Group justify="flex-end" mt="xs">
          <Button type="submit" loading={saving}>
            {list ? "Save" : "Make list"}
          </Button>
        </Group>
      </Form>
    </Modal>
  );
}

/**
 * What each member a list is shared with may do besides viewing it: edit it,
 * share it, each on its own. Who may edit is for someone who may edit the
 * list to say; who may share, for someone who may share it.
 */
function ListSharing({
  people,
  value,
  canEdit,
  canShare,
  onChange,
}: {
  people: string[];
  value: Record<string, SharePermission[]>;
  canEdit: boolean;
  canShare: boolean;
  onChange: (next: Record<string, SharePermission[]>) => void;
}) {
  const { nameOf, avatarUrlOf } = useHouseholdMembers();
  if (people.length === 0) return null;
  const set = (userId: string, permission: SharePermission, on: boolean) => {
    const rest = (value[userId] ?? []).filter((held) => held !== permission);
    onChange({ ...value, [userId]: on ? [...rest, permission] : rest });
  };
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        Everyone listed sees the list. Tick what else each may do.
      </Text>
      {people.map((userId) => {
        const name = nameOf(userId);
        const held = value[userId] ?? [];
        return (
          <Group key={userId} gap="md" wrap="nowrap" mih={{ base: 44, sm: 36 }}>
            <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
              <UserAvatar size="sm" name={name} avatarUrl={avatarUrlOf(userId)} />
              <Text size="sm" truncate>
                {name}
              </Text>
            </Group>
            <Checkbox
              label="Edit"
              aria-label={`${name} may edit`}
              checked={held.includes("edit")}
              onChange={(event) => set(userId, "edit", event.currentTarget.checked)}
              disabled={!canEdit || !canShare}
            />
            <Checkbox
              label="Share"
              aria-label={`${name} may share`}
              checked={held.includes("share")}
              onChange={(event) => set(userId, "share", event.currentTarget.checked)}
              disabled={!canShare}
            />
          </Group>
        );
      })}
      <Text size="xs" c="dimmed">
        Edit: add, change, tick off and reorder items, and rename the list. Share: who it
        is shared with.
      </Text>
    </Stack>
  );
}
