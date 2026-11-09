import { useState } from "react";
import { Group, Stack, Text } from "@mantine/core";
import { notifyError } from "@frontend/api/errors";
import { EmptyState } from "@frontend/ds/EmptyState";
import { SidePanel } from "@frontend/ds/SidePanel";
import { useAskChat, type AskInput } from "../AskChatContext";
import {
  onThisBranch,
  useConversationActions,
  useConversations,
} from "../useConversations";
import { AskComposer } from "./AskComposer";
import { AskConversation } from "./AskConversation";
import { Thinking } from "@frontend/ds/chat/Thinking";
import { AskMessage } from "./AskMessage";

/**
 * The assistant's side panel: one conversation at a time. A draft panel has
 * no conversation until something is asked; the first message creates it.
 */
export function AskChat() {
  const { opened, sessionId, pending, close, openNew, openWithMessage, clearPending } =
    useAskChat();
  const sessions = useConversations();
  const { create } = useConversationActions();
  const session = sessions.data?.find((item) => item.id === sessionId) ?? null;
  const draft = sessionId === null;
  // The first message, shown while its conversation is being created.
  const [starting, setStarting] = useState<AskInput | null>(null);

  const startConversation = (text: string, files: AskInput["files"]): boolean => {
    const input = { text, files };
    setStarting(input);
    create
      .mutateAsync(undefined)
      .then((created) => openWithMessage(created.id, input))
      .catch((err: unknown) => notifyError(err, "Could not start the conversation"))
      .finally(() => setStarting(null));
    return true;
  };

  return (
    <SidePanel
      opened={opened}
      onClose={close}
      title={
        <Group gap="sm" wrap="nowrap">
          <Text fw={600} c="inherit" truncate>
            {draft ? "Ask" : (session?.title ?? "Ask")}
          </Text>
        </Group>
      }
    >
      {draft ? (
        <>
          {starting ? (
            <Stack flex={1} gap="sm" py="xs">
              <AskMessage
                message={{
                  id: "draft",
                  role: "user",
                  parts: [...starting.files, { type: "text", text: starting.text }],
                }}
              />
              <Thinking />
            </Stack>
          ) : (
            <Stack flex={1} justify="center">
              <EmptyState
                title="Ask anything about the household"
                description="Tasks, the calendar, who is doing what. The assistant can look things up and make changes for you."
              />
            </Stack>
          )}
          <Stack gap={4} pt="sm">
            <AskComposer
              disabled={create.isPending}
              onSend={startConversation}
              onNew={openNew}
            />
          </Stack>
        </>
      ) : (
        opened &&
        sessionId &&
        (session && !onThisBranch(session) ? (
          <Stack flex={1} justify="center">
            <EmptyState
              title="Started on another branch"
              description="A conversation is continued where it was started. Ask here to begin a new one."
            />
          </Stack>
        ) : (
          <AskConversation
            key={sessionId}
            sessionId={sessionId}
            // A title is given by the first message, so a titled conversation has some.
            hasHistory={session?.title != null}
            readOnly={session?.archivedAt != null}
            pending={pending?.sessionId === sessionId ? pending : null}
            onPendingSent={clearPending}
            onNew={openNew}
          />
        ))
      )}
    </SidePanel>
  );
}
