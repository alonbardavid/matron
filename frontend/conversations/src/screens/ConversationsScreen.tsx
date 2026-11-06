import { Button, Divider, Group, Loader, Stack, Switch, Text } from "@mantine/core";
import { useState } from "react";
import { useAskChat } from "@frontend/ask/AskChatContext";
import {
  onThisBranch,
  useConversationActions,
  useConversations,
  useStartAsk,
} from "@frontend/ask/useConversations";
import { useMe } from "@frontend/auth/useMe";
import { useBuildChat } from "@frontend/build/BuildChatContext";
import {
  useArchiveSession,
  useClearSession,
  useNewSession,
  useSessions,
} from "@frontend/build/useSessions";
import { SessionStatusBadge } from "@frontend/build/widgets/SessionStatusBadge";
import { Card } from "@frontend/ds/Card";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { EmptyState } from "@frontend/ds/EmptyState";
import { IconPlus } from "@frontend/ds/icons";
import { Page } from "@frontend/ds/Page";

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Every conversation: with the assistant, and, for builders, with the planner and builder. */
export function ConversationsScreen() {
  const { can } = useMe();
  return (
    <Page
      title="Conversations"
      description="With the assistant, and about changes to the app."
    >
      <AskSessions />
      {can("create") && <BuildSessions />}
    </Page>
  );
}

function AskSessions() {
  const sessions = useConversations();
  const { archive } = useConversationActions();
  const askChat = useAskChat();
  const { startNew } = useStartAsk();
  const [showArchived, setShowArchived] = useState(false);
  const all = [...(sessions.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const archivedCount = all.filter((session) => session.archivedAt !== null).length;
  const items = all.filter((session) => (session.archivedAt !== null) === showArchived);

  const rows = items.map((session) => {
    const here = onThisBranch(session);
    return (
      <Group key={session.id} justify="space-between" px="md" py="sm" wrap="wrap">
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <Text size="sm" fw={500} truncate>
            {session.title ?? "New conversation"}
          </Text>
          <Text size="xs" c="dimmed">
            {when(session.updatedAt)}
            {!here &&
              (session.branch === "main"
                ? " · started on main"
                : " · started on another branch")}
          </Text>
        </div>
        <Group gap="xs" wrap="nowrap">
          {session.archivedAt === null && here && (
            <ConfirmButton
              size="xs"
              variant="subtle"
              message="Archive this conversation? It stays readable."
              confirmLabel="Archive"
              onConfirm={() => archive.mutateAsync({ id: session.id })}
            >
              Archive
            </ConfirmButton>
          )}
          <Button
            size="xs"
            variant="light"
            disabled={!here}
            onClick={() => askChat.open(session.id)}
          >
            {session.archivedAt === null ? "Open" : "View"}
          </Button>
        </Group>
      </Group>
    );
  });
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Group gap="md">
          <Text fw={600}>Ask</Text>
          {archivedCount > 0 && (
            <Switch
              size="sm"
              label={`Show archived (${archivedCount})`}
              checked={showArchived}
              onChange={(event) => setShowArchived(event.currentTarget.checked)}
            />
          )}
        </Group>
        <Button size="xs" variant="light" leftSection={<IconPlus />} onClick={startNew}>
          New conversation
        </Button>
      </Group>
      <Card p={0}>
        {sessions.isLoading ? (
          <Group justify="center" p="xl">
            <Loader size="sm" />
          </Group>
        ) : rows.length === 0 ? (
          <EmptyState
            title={showArchived ? "No archived conversations" : "No conversations yet"}
            description={showArchived ? undefined : "Ask the assistant anything."}
          />
        ) : (
          <Stack gap={0}>
            {rows.map((row, index) => (
              <div key={items[index]!.id}>
                {index > 0 && <Divider />}
                {row}
              </div>
            ))}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

function BuildSessions() {
  const sessions = useSessions();
  const archive = useArchiveSession();
  const clear = useClearSession();
  const buildChat = useBuildChat();
  const newSession = useNewSession();
  const [showArchived, setShowArchived] = useState(false);
  const all = [...(sessions.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const archivedCount = all.filter((session) => session.archivedAt !== null).length;
  const items = all.filter((session) => (session.archivedAt !== null) === showArchived);

  const rows = items.map((session) => {
    const archived = session.archivedAt !== null;
    return (
      <Group key={session.id} justify="space-between" px="md" py="sm" wrap="wrap">
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" fw={500} truncate>
              {session.title ?? "Untitled change"}
            </Text>
            <SessionStatusBadge status={session.status} archived={archived} />
          </Group>
          <Text size="xs" c="dimmed">
            {when(session.updatedAt)}
          </Text>
        </div>
        <Group gap="xs" wrap="nowrap">
          {session.canArchive && (
            <ConfirmButton
              size="xs"
              variant="subtle"
              message="Archive this session? Its chat stays readable."
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
              message="Clear this session's chat and builder state for good?"
              confirmLabel="Clear"
              onConfirm={() => clear.mutateAsync({ id: session.id })}
            >
              Clear
            </ConfirmButton>
          )}
          {!session.clearedAt && (
            <Button size="xs" variant="light" onClick={() => buildChat.open(session.id)}>
              {archived ? "View" : "Open"}
            </Button>
          )}
        </Group>
      </Group>
    );
  });

  return (
    <Stack gap="xs" mt="md">
      <Group justify="space-between">
        <Group gap="md">
          <Text fw={600}>Build sessions</Text>
          {archivedCount > 0 && (
            <Switch
              size="sm"
              label={`Show archived (${archivedCount})`}
              checked={showArchived}
              onChange={(event) => setShowArchived(event.currentTarget.checked)}
            />
          )}
        </Group>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus />}
          onClick={newSession.start}
        >
          New session
        </Button>
      </Group>
      <Card p={0}>
        {sessions.isLoading ? (
          <Group justify="center" p="xl">
            <Loader size="sm" />
          </Group>
        ) : rows.length === 0 ? (
          <EmptyState
            title={showArchived ? "No archived sessions" : "No build sessions yet"}
            description={
              showArchived ? undefined : "Press Build to ask for a change to the app."
            }
          />
        ) : (
          <Stack gap={0}>
            {rows.map((row, index) => (
              <div key={items[index]!.id}>
                {index > 0 && <Divider />}
                {row}
              </div>
            ))}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
