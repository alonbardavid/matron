import { useState, type ReactNode } from "react";
import { Button, Divider, Group, Loader, Stack, Switch, Text } from "@mantine/core";
import type { Branch } from "@shared/contract/arch/branches";
import type { BuildSession } from "@shared/contract/arch/sessions";
import type { OnOutOfDate } from "@frontend/branches/useBranchActions";
import { useBranches } from "@frontend/branches/useBranches";
import { BranchRow } from "@frontend/branches/widgets/BranchRow";
import { Card } from "@frontend/ds/Card";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { EmptyState } from "@frontend/ds/EmptyState";
import { IconPlus } from "@frontend/ds/icons";
import { Page } from "@frontend/ds/Page";
import { useBuildChat } from "../BuildChatContext";
import {
  useArchiveSession,
  useClearSession,
  useNewSession,
  useSessions,
} from "../useSessions";
import { SessionStatusBadge } from "../widgets/SessionStatusBadge";

type Build =
  | {
      kind: "branch";
      id: string;
      updatedAt: number;
      branch: Branch;
      session?: BuildSession;
    }
  | { kind: "conversation"; id: string; updatedAt: number; session: BuildSession };

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Every build: the branches deployed from a chat, and the chats that have no
 * branch yet. A session with a branch is listed once, as its branch.
 */
function useBuilds(): {
  live: Build[];
  archived: Build[];
  isLoading: boolean;
  error: Error | null;
} {
  const sessions = useSessions();
  const { query, branches, archived: archivedBranches } = useBranches();
  const byId = new Map((sessions.data ?? []).map((session) => [session.id, session]));
  const asBuild = (branch: Branch): Build => ({
    kind: "branch",
    id: branch.id,
    updatedAt: branch.updatedAt,
    branch,
    session: byId.get(branch.buildSessionId),
  });
  const conversations = (sessions.data ?? [])
    .filter((session) => session.branchId === null)
    .map<Build>((session) => ({
      kind: "conversation",
      id: session.id,
      updatedAt: session.updatedAt,
      session,
    }));
  const newest = (a: Build, b: Build) => b.updatedAt - a.updatedAt;
  const isArchived = (build: Build) =>
    build.kind === "conversation" && build.session.archivedAt !== null;
  return {
    live: [...branches.map(asBuild), ...conversations.filter((b) => !isArchived(b))].sort(
      newest,
    ),
    archived: [
      ...archivedBranches.map(asBuild),
      ...conversations.filter(isArchived),
    ].sort(newest),
    isLoading: sessions.isLoading || query.isLoading,
    error: sessions.error ?? query.error,
  };
}

/** Archive and clear, for the session's creator and the owner as the server allows. */
function SessionActions({ session }: { session: BuildSession }) {
  const archive = useArchiveSession();
  const clear = useClearSession();
  return (
    <>
      {session.canArchive && (
        <ConfirmButton
          size="xs"
          variant="subtle"
          message="Archive this conversation? Its chat stays readable."
          confirmLabel="Archive"
          onConfirm={() => archive.mutateAsync({ id: session.id })}
        >
          Archive
        </ConfirmButton>
      )}
      {session.canClear && (
        <ConfirmButton
          size="xs"
          variant="subtle"
          color="red"
          message="Clear this conversation's chat and builder state for good?"
          confirmLabel="Clear"
          onConfirm={() => clear.mutateAsync({ id: session.id })}
        >
          Clear
        </ConfirmButton>
      )}
    </>
  );
}

/** A build chat that has not deployed a branch yet. */
function ConversationRow({ session }: { session: BuildSession }) {
  const buildChat = useBuildChat();
  const archived = session.archivedAt !== null;
  return (
    <Group
      justify="space-between"
      px="md"
      py="sm"
      wrap="wrap"
      style={archived ? { opacity: 0.7 } : undefined}
    >
      <div style={{ minWidth: 0, flex: "1 1 200px" }}>
        <Group gap="xs" wrap="nowrap">
          <Text size="sm" fw={500} truncate>
            {session.title ?? "Untitled change"}
          </Text>
          <SessionStatusBadge status={session.status} archived={archived} />
        </Group>
        <Text size="xs" c="dimmed">
          Conversation · {when(session.updatedAt)}
        </Text>
      </div>
      <Group gap="xs" wrap="nowrap">
        <SessionActions session={session} />
        {!session.clearedAt && (
          <Button size="xs" variant="light" onClick={() => buildChat.open(session.id)}>
            Chat
          </Button>
        )}
      </Group>
    </Group>
  );
}

interface BuildsScreenProps {
  onOutOfDate?: OnOutOfDate;
}

/** Changes to the app: the conversations with the planner and builder, and the branches they deployed. */
export function BuildsScreen({ onOutOfDate }: BuildsScreenProps) {
  const { current } = useBranches();
  const buildChat = useBuildChat();
  const newSession = useNewSession();
  const { live, archived, isLoading, error } = useBuilds();
  const [showArchived, setShowArchived] = useState(false);
  const items = showArchived ? archived : live;

  const row = (build: Build): ReactNode =>
    build.kind === "branch" ? (
      <BranchRow
        branch={build.branch}
        current={current}
        title={build.session?.title}
        onOutOfDate={onOutOfDate}
        onChat={buildChat.open}
      >
        {build.session?.canClear && <SessionActions session={build.session} />}
      </BranchRow>
    ) : (
      <ConversationRow session={build.session} />
    );

  return (
    <Page
      size="md"
      title="Builds"
      description="Ask for a change in a build conversation; the builder deploys it to a branch you can try before it is merged into main."
      action={
        <Group gap="md">
          {archived.length > 0 && (
            <Switch
              size="sm"
              label={`Show archived (${archived.length})`}
              checked={showArchived}
              onChange={(event) => setShowArchived(event.currentTarget.checked)}
            />
          )}
          <Button size="xs" leftSection={<IconPlus />} onClick={newSession.start}>
            New build
          </Button>
        </Group>
      }
    >
      <Card p={0}>
        {isLoading ? (
          <Group justify="center" p="xl">
            <Loader size="sm" />
          </Group>
        ) : error ? (
          <EmptyState title="Could not load builds" description={error.message} />
        ) : items.length === 0 ? (
          <EmptyState
            title={showArchived ? "No archived builds" : "No builds yet"}
            description={
              showArchived ? undefined : "Press New build to ask for a change to the app."
            }
          />
        ) : (
          <Stack gap={0}>
            {items.map((build, index) => (
              <div key={`${build.kind}:${build.id}`}>
                {index > 0 && <Divider />}
                {row(build)}
              </div>
            ))}
          </Stack>
        )}
      </Card>
    </Page>
  );
}
