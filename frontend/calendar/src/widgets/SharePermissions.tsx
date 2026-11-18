import { Checkbox, Group, Stack, Text } from "@mantine/core";
import type { SharePermission } from "@shared/contract/app/calendar";
import { useHouseholdMembers } from "@frontend/auth/useHouseholdMembers";
import { UserAvatar } from "@frontend/auth/widgets/UserAvatar";

/**
 * What each member an event is shared with may do besides viewing it: share
 * it, edit it, each on its own. Who may edit is for someone who may edit the
 * event to say (`canEdit`); anyone else sees it as it stands.
 */
export function SharePermissions({
  people,
  value,
  canEdit,
  onChange,
}: {
  people: string[];
  value: Record<string, SharePermission[]>;
  canEdit: boolean;
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
        Everyone listed sees the event. Tick what else each may do.
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
              label="Share"
              aria-label={`${name} may share`}
              checked={held.includes("share")}
              onChange={(event) => set(userId, "share", event.currentTarget.checked)}
            />
            <Checkbox
              label="Edit"
              aria-label={`${name} may edit`}
              checked={held.includes("edit")}
              onChange={(event) => set(userId, "edit", event.currentTarget.checked)}
              disabled={!canEdit}
            />
          </Group>
        );
      })}
      <Text size="xs" c="dimmed">
        Share: who it is shared with and who attends.{" "}
        {canEdit
          ? "Edit: its times and details, and removing it."
          : "Edit is set by someone who may edit the event."}
      </Text>
    </Stack>
  );
}
