import { Group, Select, Stack, Text } from "@mantine/core";
import type { SharePermission } from "@shared/contract/app/calendar";
import { useHouseholdMembers } from "@frontend/auth/useHouseholdMembers";
import { UserAvatar } from "@frontend/auth/widgets/UserAvatar";

export const PERMISSION_LABELS: Record<SharePermission, string> = {
  view: "Can view",
  edit: "Can edit",
  manage: "Can manage",
};

const OPTIONS = (Object.keys(PERMISSION_LABELS) as SharePermission[]).map((value) => ({
  value,
  label: PERMISSION_LABELS[value],
}));

/** What each member an event is shared with may do; edit for anyone not set. */
export function SharePermissions({
  people,
  value,
  onChange,
}: {
  people: string[];
  value: Record<string, SharePermission>;
  onChange: (next: Record<string, SharePermission>) => void;
}) {
  const { nameOf, avatarUrlOf } = useHouseholdMembers();
  if (people.length === 0) return null;
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        Edit: times, details, repetition, labels and attachments. Manage: also who it is
        shared with, who attends, and removing it.
      </Text>
      {people.map((userId) => (
        <Group key={userId} gap="xs" wrap="nowrap">
          <UserAvatar size="sm" name={nameOf(userId)} avatarUrl={avatarUrlOf(userId)} />
          <Text size="sm" style={{ flex: 1 }} truncate>
            {nameOf(userId)}
          </Text>
          <Select
            aria-label={`What ${nameOf(userId)} may do`}
            size="xs"
            w={130}
            data={OPTIONS}
            value={value[userId] ?? "edit"}
            onChange={(next) =>
              next && onChange({ ...value, [userId]: next as SharePermission })
            }
            allowDeselect={false}
          />
        </Group>
      ))}
    </Stack>
  );
}
