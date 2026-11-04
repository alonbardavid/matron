import { Avatar, Tooltip } from "@mantine/core";
import { initials } from "../initials";
import { useHouseholdMembers } from "../useHouseholdMembers";

/** Small avatars for a list of user ids, with names on hover. */
export function PeopleAvatars({ ids, max = 4 }: { ids: string[]; max?: number }) {
  const { nameOf } = useHouseholdMembers();
  if (ids.length === 0) return null;
  return (
    <Avatar.Group spacing="xs">
      {ids.slice(0, max).map((id) => (
        <Tooltip key={id} label={nameOf(id)} withArrow>
          <Avatar size="sm" radius="xl" color="rose">
            {initials(nameOf(id))}
          </Avatar>
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
