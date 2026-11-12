import { Alert, Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { useBuildChat } from "@frontend/build/BuildChatContext";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { IconPull } from "@frontend/ds/icons";

/**
 * "Check updates": pulls upstream into the deployment's repository and says
 * whether main has it all; when it does not, starts a build session that merges it
 * on a new branch.
 * The button and what the check found are placed apart, so they share this.
 */
export function useUpstreamUpdates({ onStarted }: { onStarted: () => void }) {
  const buildChat = useBuildChat();
  const check = useMutation(
    // A failed check stays on the page, under the button, rather than in a toast.
    orpc.upstream.check.mutationOptions(),
  );
  const merge = useMutation(
    orpc.upstream.merge.mutationOptions({
      onSuccess: ({ sessionId }) => {
        notifications.show({
          message: "The builder is merging the upstream updates on a new branch",
        });
        onStarted();
        buildChat.open(sessionId);
      },
      onError: (err) => notifyError(err, "Could not start the upstream update"),
    }),
  );
  return { check, merge };
}

type UpstreamUpdatesState = ReturnType<typeof useUpstreamUpdates>;

export function CheckUpdatesButton({ upstream }: { upstream: UpstreamUpdatesState }) {
  return (
    <Button
      size="xs"
      variant="default"
      leftSection={<IconPull size={14} />}
      loading={upstream.check.isPending}
      onClick={() => upstream.check.mutate({})}
    >
      Check updates
    </Button>
  );
}

/** What the last check found; nothing before the first one. */
export function UpstreamUpdatesResult({ upstream }: { upstream: UpstreamUpdatesState }) {
  const { check, merge } = upstream;
  if (check.isError) {
    return (
      <Alert color="red" title="Could not check upstream">
        <Text size="sm">{check.error.message}</Text>
      </Alert>
    );
  }
  if (!check.data) return null;
  if (check.data.upToDate) {
    return (
      <Alert color="sage" title="Up to date with upstream">
        <Text size="sm">This deployment has everything upstream has.</Text>
      </Alert>
    );
  }
  return (
    <Alert color="blue" title="Upstream has updates">
      <Group>
        <ConfirmButton
          size="xs"
          message="Start a build that merges the updates on a new branch? It deploys a Preview to try, like any change, and merges into main from the branch menu."
          confirmLabel="Start the build"
          loading={merge.isPending}
          onConfirm={() => merge.mutateAsync({})}
        >
          Merge into a new branch
        </ConfirmButton>
      </Group>
    </Alert>
  );
}
