import { Avatar, Tooltip } from "@mantine/core";
import { useHouseholdMembers } from "../useHouseholdMembers";
import { UserAvatar } from "./UserAvatar";

/** Small avatars for a list of user ids, with names on hover. */
export function PeopleAvatars({ ids, max = 4 }: { ids: string[]; max?: number }) {
  const { nameOf, avatarUrlOf } = useHouseholdMembers();
  if (ids.length === 0) return null;
  return (
    <Avatar.Group spacing="xs">
      {ids.slice(0, max).map((id) => (
        <Tooltip key={id} label={nameOf(id)} withArrow>
          <UserAvatar size="sm" name={nameOf(id)} avatarUrl={avatarUrlOf(id)} />
        </Tooltip>
      ))}
      {ids.length > max && (
        <Avatar size="sm" radius="xl">
          +{ids.length - max}
        </Avatar>
      )}
    </Avatar.Group>
  );
}
