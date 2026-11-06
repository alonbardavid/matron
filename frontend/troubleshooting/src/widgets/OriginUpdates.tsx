import { Alert, Anchor, Button, Code, Group, List, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation } from "@tanstack/react-query";
import type { OriginStatus } from "@shared/contract/arch/troubleshooting";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { useBuildChat } from "@frontend/build/BuildChatContext";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { IconRefresh } from "@frontend/ds/icons";
import { formatWhen } from "../format";
import { ProblemNotice } from "./ProblemNotice";

/** How many of the new commits the notice lists. */
const SHOWN_COMMITS = 8;

/**
 * "Check origin updates": compares upstream's main with this deployment's, and
 * when upstream has more, starts a build session that merges it on a new branch.
 */
export function OriginUpdates({ onStarted }: { onStarted: () => void }) {
  const buildChat = useBuildChat();
  const check = useMutation(
    orpc.troubleshooting.origin.check.mutationOptions({
      onError: (err) => notifyError(err, "Could not check for origin updates"),
    }),
  );
  const merge = useMutation(
    orpc.troubleshooting.origin.merge.mutationOptions({
      onSuccess: ({ sessionId }) => {
        notifications.show({
          message: "The builder is merging the origin updates on a new branch",
        });
        onStarted();
        buildChat.open(sessionId);
      },
      onError: (err) => {
        notifyError(err, "Could not start the origin update");
        check.mutate({});
      },
    }),
  );

  const result = check.data;
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" c="dimmed">
          Every branch, whoever made it.
        </Text>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconRefresh size={14} />}
          loading={check.isPending}
          onClick={() => check.mutate({})}
        >
          Check origin updates
        </Button>
      </Group>
      {result?.problem && (
        <ProblemNotice problem={result.problem} title="Could not check origin" />
      )}
      {result?.status && (
        <StatusNotice
          status={result.status}
          merging={merge.isPending}
          onMerge={() => merge.mutateAsync({ commit: result.status!.head.sha })}
          onOpenSession={buildChat.open}
        />
      )}
    </Stack>
  );
}

function StatusNotice({
  status,
  merging,
  onMerge,
  onOpenSession,
}: {
  status: OriginStatus;
  merging: boolean;
  onMerge: () => Promise<unknown>;
  onOpenSession: (sessionId: string) => void;
}) {
  const source = (
    <>
      <Anchor href={status.url} target="_blank" rel="noreferrer" size="sm">
        {status.repository}
      </Anchor>{" "}
      <Code>{status.branch}</Code>
    </>
  );
  const checked = `Checked ${formatWhen(status.checkedAt)}.`;
  if (status.state === "up-to-date") {
    return (
      <Alert color="sage" title="Up to date with origin">
        <Text size="sm">
          This deployment has everything on {source} (
          <Code>{status.head.sha.slice(0, 7)}</Code>). {checked}
        </Text>
      </Alert>
    );
  }
  const count = status.commits.length;
  const shown = status.commits.slice(0, SHOWN_COMMITS);
  const hidden = count - shown.length;
  return (
    <Alert
      color="blue"
      title={
        status.state === "unknown"
          ? "Origin may have updates"
          : `Origin has ${count}${status.moreCommits ? "+" : ""} new commit${count === 1 ? "" : "s"}`
      }
    >
      <Stack gap="xs">
        <Text size="sm">
          {status.state === "unknown"
            ? "This deployment's history is too long to tell for sure which of these it already has; a merge brings in whatever it lacks. "
            : null}
          From {source} at <Code>{status.head.sha.slice(0, 7)}</Code>
          {status.filesChanged !== null &&
            `, ${status.filesChanged} file${status.filesChanged === 1 ? "" : "s"} changed`}
          . {checked}
        </Text>
        <List size="sm" spacing={2}>
          {shown.map((commit) => (
            <List.Item key={commit.sha}>
              <Anchor href={commit.url} target="_blank" rel="noreferrer" size="sm">
                <Code>{commit.sha.slice(0, 7)}</Code>
              </Anchor>{" "}
              {commit.title}
              {commit.author && (
                <Text span size="xs" c="dimmed">
                  {" "}
                  · {commit.author}
                </Text>
              )}
            </List.Item>
          ))}
          {(hidden > 0 || status.moreCommits) && (
            <List.Item>
              <Text span size="sm" c="dimmed">
                …and {hidden > 0 ? `${hidden}${status.moreCommits ? "+" : ""} ` : ""}more
              </Text>
            </List.Item>
          )}
        </List>
        {status.touchesBuilderImage && (
          <Text size="sm" c="dimmed">
            Some of this changes the builder itself (<Code>apps/builder/</Code>); that
            part applies after the next <Code>pnpm run deploy</Code> from a terminal.
          </Text>
        )}
        {status.pending ? (
          <Group gap="xs">
            <Text size="sm">
              An origin update is already open on branch{" "}
              <Code>{status.pending.branchName}</Code> ({status.pending.status}). Merge or
              abandon it from the branch menu first.
            </Text>
            <Button
              size="xs"
              variant="default"
              onClick={() => onOpenSession(status.pending!.buildSessionId)}
            >
              Open its session
            </Button>
          </Group>
        ) : (
          <Group>
            <ConfirmButton
              size="xs"
              message="Start a build that merges these commits on a new branch? It deploys a Preview to try, like any change, and merges into main from the branch menu."
              confirmLabel="Start the build"
              loading={merging}
              onConfirm={onMerge}
            >
              Merge into a new branch
            </ConfirmButton>
          </Group>
        )}
      </Stack>
    </Alert>
  );
}
