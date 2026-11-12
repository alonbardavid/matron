import { Avatar, type AvatarProps } from "@mantine/core";
import { initials } from "../initials";

interface UserAvatarProps extends Omit<AvatarProps, "src" | "children"> {
  name: string;
  /** Their picture, or null for initials. */
  avatarUrl: string | null | undefined;
}

/** A member's picture, or their initials without one. */
export function UserAvatar({ name, avatarUrl, ...props }: UserAvatarProps) {
  return (
    <Avatar radius="xl" color="rose" {...props} src={avatarUrl ?? undefined} alt="">
      {initials(name)}
    </Avatar>
  );
}
