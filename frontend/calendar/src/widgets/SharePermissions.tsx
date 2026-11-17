import { Group, Select, Stack, Text } from "@mantine/core";
import { SHARE_PERMISSIONS, type SharePermission } from "@shared/contract/app/calendar";
import { useHouseholdMembers } from "@frontend/auth/useHouseholdMembers";
import { UserAvatar } from "@frontend/auth/widgets/UserAvatar";

export const PERMISSION_LABELS: Record<SharePermission, string> = {
  view: "Can view",
  share: "Can share",
  edit: "Can edit",
};

const optionOf = (value: SharePermission) => ({ value, label: PERMISSION_LABELS[value] });

/**
 * What each member an event is shared with may do. The caller gives as much as
 * they may themselves (`upTo`), which is also what anyone not set gets, and
 * leaves alone whoever has more.
 */
export function SharePermissions({
  people,
  value,
  upTo,
  onChange,
}: {
  people: string[];
  value: Record<string, SharePermission>;
  upTo: SharePermission;
  onChange: (next: Record<string, SharePermission>) => void;
}) {
  const { nameOf, avatarUrlOf } = useHouseholdMembers();
  if (people.length === 0) return null;
  const options = SHARE_PERMISSIONS.slice(0, SHARE_PERMISSIONS.indexOf(upTo) + 1);
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        Share: also who it is shared with and who attends. Edit: also its times and
        details, and removing it.
      </Text>
      {people.map((userId) => {
        const level = value[userId] ?? upTo;
        const beyond = !options.includes(level);
        return (
          <Group key={userId} gap="xs" wrap="nowrap">
            <UserAvatar size="sm" name={nameOf(userId)} avatarUrl={avatarUrlOf(userId)} />
            <Text size="sm" style={{ flex: 1 }} truncate>
              {nameOf(userId)}
            </Text>
            <Select
              aria-label={`What ${nameOf(userId)} may do`}
              size="xs"
              w={130}
              data={(beyond ? [level] : options).map(optionOf)}
              value={level}
              onChange={(next) =>
                next && onChange({ ...value, [userId]: next as SharePermission })
              }
              disabled={beyond}
              allowDeselect={false}
            />
          </Group>
        );
      })}
    </Stack>
  );
}
