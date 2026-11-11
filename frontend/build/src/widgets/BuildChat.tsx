import { useState } from "react";
import { Box, Group, Stack, Text } from "@mantine/core";
import { notifyError } from "@frontend/api/errors";
import { ChatComposer } from "@frontend/ds/chat/ChatComposer";
import { EmptyState } from "@frontend/ds/EmptyState";
import { SidePanel } from "@frontend/ds/SidePanel";
import type { BuildPhase } from "@shared/contract/arch/sessions";
import { useBuildChat, type BuildInput } from "../BuildChatContext";
import { useCreateSession, useSessions } from "../useSessions";
import { BuildConversation } from "./BuildConversation";
import { BuildMessage } from "./BuildMessage";
import { SessionStatusBadge } from "./SessionStatusBadge";
import { Thinking } from "@frontend/ds/chat/Thinking";

/**
 * The build chat's side panel: one session at a time. A draft panel has no
 * session until something is said; the first message creates one and is
 * sent to it.
 */
export function BuildChat() {
  const { opened, sessionId, close, pending, clearPending, openWithMessage } =
    useBuildChat();
  const sessions = useSessions();
  const create = useCreateSession();
  const session = sessions.data?.find((item) => item.id === sessionId) ?? null;
  const archived = session?.archivedAt != null;
  const draft = sessionId === null;
  // The first message, shown while its session is being created.
  const [starting, setStarting] = useState<BuildInput | null>(null);
  // The object's phase arrives as it changes; the row catches up on the next refetch.
  const [phase, setPhase] = useState<BuildPhase | null>(null);

  const startSession = (text: string, files: BuildInput["files"]): boolean => {
    const input = { text, files };
    setStarting(input);
    create
      .mutateAsync(undefined)
      .then((created) => openWithMessage(created.id, input))
      .catch((err: unknown) => notifyError(err, "Could not start the session"))
      .finally(() => setStarting(null));
    return true;
  };

  return (
    <SidePanel
      opened={opened}
      onClose={close}
      title={
        // A long title gives way; the status stays whole.
        <Group gap="sm" wrap="nowrap" preventGrowOverflow={false}>
          <Text fw={600} c="inherit" miw={0} truncate>
            {draft ? "New session" : (session?.title ?? "Build")}
          </Text>
          {session && (
            <Box style={{ flexShrink: 0 }}>
              <SessionStatusBadge status={phase ?? session.status} archived={archived} />
            </Box>
          )}
        </Group>
      }
    >
      {draft ? (
        <>
          {starting ? (
            <Stack flex={1} gap="sm" py="xs">
              <BuildMessage
                message={{
                  id: "draft",
                  role: "user",
                  parts: [...starting.files, { type: "text", text: starting.text }],
                }}
                runsFor={() => []}
              />
              <Thinking />
            </Stack>
          ) : (
            <Stack flex={1} justify="center">
              <EmptyState
                title="What would you like to change?"
                description="Describe the change in plain words. The planner asks questions when it needs to, then hands the plan to the builder, which usually takes five to ten minutes."
              />
            </Stack>
          )}
          <Stack gap={4} pt="sm">
            <ChatComposer
              disabled={create.isPending}
              placeholder="Describe the change you want"
              onSend={startSession}
              hint="Your first message starts the session. Enter sends, Shift+Enter adds a line."
            />
          </Stack>
        </>
      ) : (
        opened &&
        sessionId && (
          <BuildConversation
            key={sessionId}
            sessionId={sessionId}
            // A title is given by the first message, so a titled session has some.
            hasHistory={session?.title != null}
            readOnly={archived}
            pending={pending?.sessionId === sessionId ? pending : null}
            onPendingSent={clearPending}
            onPhase={setPhase}
          />
        )
      )}
    </SidePanel>
  );
}
