import { useRef, type ChangeEvent } from "react";
import { Button, Group, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MAX_PICTURE_BYTES, PICTURE_MIME_TYPES } from "@shared/contract/app/files";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { useHouseholdMembers } from "../useHouseholdMembers";
import { useMe } from "../useMe";
import { UserAvatar } from "./UserAvatar";

/** Your own picture: upload one, or go back to initials. */
export function AvatarEditor() {
  const { me } = useMe();
  const { avatarUrlOf, isLoading } = useHouseholdMembers();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.users.key() });
  const upload = useMutation(
    orpc.users.setAvatar.mutationOptions({
      onSuccess: async () => {
        await refresh();
        notifications.show({ message: "Picture saved" });
      },
      onError: (err) => notifyError(err, "Could not save the picture"),
    }),
  );
  const remove = useMutation(
    orpc.users.removeAvatar.mutationOptions({
      onSuccess: async () => {
        await refresh();
        notifications.show({ message: "Picture removed" });
      },
      onError: (err) => notifyError(err, "Could not remove the picture"),
    }),
  );

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const picture = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!picture) return;
    if (picture.size > MAX_PICTURE_BYTES) {
      notifyError(
        `Pick a picture under ${Math.round(MAX_PICTURE_BYTES / 1024 / 1024)} MB`,
      );
      return;
    }
    upload.mutate({ picture });
  };

  if (!me) return null;
  const avatarUrl = avatarUrlOf(me.id);
  const busy = upload.isPending || remove.isPending || isLoading;
  return (
    <Group gap="md" wrap="nowrap" align="center">
      <UserAvatar
        size={64}
        name={me.name}
        avatarUrl={avatarUrl}
        data-testid="my-avatar"
      />
      <Stack gap={6}>
        <Text size="sm" c="dimmed">
          A square picture; PNG, JPEG, GIF or WebP.
        </Text>
        <Group gap="xs">
          <input
            ref={input}
            type="file"
            accept={PICTURE_MIME_TYPES.join(",")}
            aria-label="Picture file"
            onChange={pick}
            hidden
          />
          <Button
            size="xs"
            variant="default"
            loading={upload.isPending}
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {avatarUrl ? "Change picture" : "Upload picture"}
          </Button>
          {avatarUrl && (
            <Button
              size="xs"
              variant="subtle"
              color="red"
              loading={remove.isPending}
              disabled={busy}
              onClick={() => remove.mutate({})}
            >
              Remove picture
            </Button>
          )}
        </Group>
      </Stack>
    </Group>
  );
}
