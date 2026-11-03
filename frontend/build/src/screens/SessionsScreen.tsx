import { useState } from "react";
import { Button, Group, Loader, Switch, Table, Text } from "@mantine/core";
import { useBuildChat } from "../BuildChatContext";
import { Card } from "@frontend/ds/Card";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { EmptyState } from "@frontend/ds/EmptyState";
import { IconPlus } from "@frontend/ds/icons";
import { Page } from "@frontend/ds/Page";
import {
  useArchiveSession,
  useClearSession,
  useNewSession,
  useSessions,
} from "../useSessions";
import { SessionStatusBadge } from "../widgets/SessionStatusBadge";

export function SessionsScreen() {
  const sessions = useSessions();
  const newSession = useNewSession();
  const archive = useArchiveSession();
  const clear = useClearSession();
  const buildChat = useBuildChat();
  const [showArchived, setShowArchived] = useState(false);
  const all = [...(sessions.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const archivedCount = all.filter((session) => session.archivedAt !== null).length;
  const items = all.filter((session) => (session.archivedAt !== null) === showArchived);

  return (
    <Page
      size="md"
      title="Build sessions"
      description="Each conversation with the planner and builder."
      action={
        <Group gap="md">
          {archivedCount > 0 && (
            <Switch
              size="sm"
              label={`Show archived (${archivedCount})`}
              checked={showArchived}
              onChange={(event) => setShowArchived(event.currentTarget.checked)}
            />
          )}
          <Button leftSection={<IconPlus />} onClick={newSession.start}>
            New session
          </Button>
        </Group>
      }
    >
      <Card p={0}>
        {sessions.isLoading ? (
          <Group justify="center" p="xl">
            <Loader size="sm" />
          </Group>
        ) : sessions.isError ? (
          <EmptyState
            title="Could not load sessions"
            description={sessions.error.message}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            description="Press Build in the header to ask for your first change."
          />
        ) : (
          <Table verticalSpacing="sm" horizontalSpacing="md">
            <Table.Tbody>
              {items.map((session) => {
                const archived = session.archivedAt !== null;
                return (
                  <Table.Tr
                    key={session.id}
                    style={archived ? { opacity: 0.7 } : undefined}
                  >
                    <Table.Td>
                      <Text fw={500}>{session.title ?? "Untitled session"}</Text>
                      <Text size="xs" c="dimmed">
                        {new Date(session.createdAt).toLocaleString()}
                        {session.archivedAt !== null &&
                          ` · archived ${new Date(session.archivedAt).toLocaleString()}`}
                        {session.clearedAt !== null &&
                          ` · cleared ${new Date(session.clearedAt).toLocaleString()}`}
                      </Text>
                    </Table.Td>
                    <Table.Td w={110}>
                      <SessionStatusBadge status={session.status} archived={archived} />
                    </Table.Td>
                    <Table.Td w={180} ta="right">
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        {session.canArchive && (
                          <ConfirmButton
                            size="xs"
                            variant="subtle"
                            color="gray"
                            message="Archive this session? It stays readable but cannot be continued."
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
                            message="Clear this session? Its chat and builder state are deleted for good; only this row stays."
                            confirmLabel="Clear"
                            onConfirm={() => clear.mutateAsync({ id: session.id })}
                          >
                            Clear
                          </ConfirmButton>
                        )}
                        {session.clearedAt === null && (
                          <Button
                            size="xs"
                            variant="default"
                            onClick={() => buildChat.open(session.id)}
                          >
                            {archived ? "View" : "Open"}
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Page>
  );
}
