import { useEffect, useRef, useState } from "react";
import { Center, Group, Loader, ScrollArea, Stack, Text } from "@mantine/core";
import { useAgentChat } from "@cloudflare/think/react";
import { useAgent } from "agents/react";
import { useQueryClient } from "@tanstack/react-query";
import { askSocketPath } from "@shared/contract/app/conversations";
import { orpc } from "@frontend/api/orpc";
import { EmptyState } from "@frontend/ds/EmptyState";
import { AskComposer } from "./AskComposer";
import { AskMessage } from "./AskMessage";

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** The assistant has the message and is working on it. */
export function Thinking() {
  return (
    <Group gap="xs">
      <Loader size={12} />
      <Text size="xs" c="dimmed">
        thinking
      </Text>
    </Group>
  );
}

interface AskConversationProps {
  sessionId: string;
  /** The conversation already has messages: they show once the socket replays them. */
  hasHistory: boolean;
  /** Archived: readable, not continued. */
  readOnly: boolean;
  /** Sent once the conversation is connected, then cleared. */
  pending: string | null;
  onPendingSent: () => void;
  onNew: () => void;
}

/** The chat with the assistant for one conversation, connected while mounted. */
export function AskConversation({
  sessionId,
  hasHistory,
  readOnly,
  pending,
  onPendingSent,
  onNew,
}: AskConversationProps) {
  const agent = useAgent({
    agent: "ask-session-object",
    name: sessionId,
    host: window.location.host,
    basePath: askSocketPath(sessionId).replace(/^\//, ""),
  });
  const { messages, sendMessage, status, isStreaming } = useAgentChat({
    agent,
    body: { timeZone: TIME_ZONE },
  });
  const viewport = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  // True from the moment a message is sent until the assistant starts answering.
  const [awaiting, setAwaiting] = useState(pending !== null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (isStreaming || status === "error" || (last && last.role === "assistant"))
      setAwaiting(false);
  }, [isStreaming, status, messages]);
  const thinking = awaiting || isStreaming;
  const ask = (text: string) => {
    setAwaiting(true);
    void sendMessage({ text });
  };

  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [messages, thinking]);

  // The first message of a new conversation, sent once the socket is ready.
  const sentPending = useRef(false);
  useEffect(() => {
    if (!pending || sentPending.current || status !== "ready") return;
    sentPending.current = true;
    setAwaiting(true);
    void sendMessage({ text: pending });
    onPendingSent();
  }, [pending, status, sendMessage, onPendingSent]);

  // The assistant may have changed tasks or events: refresh them when it finishes.
  useEffect(() => {
    if (isStreaming) return;
    void queryClient.invalidateQueries({ queryKey: orpc.tasks.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.calendar.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.conversations.key() });
  }, [isStreaming, queryClient]);

  return (
    <>
      <ScrollArea flex={1} viewportRef={viewport} type="auto" offsetScrollbars>
        {messages.length === 0 && hasHistory ? (
          // The transcript arrives with the connection; nothing is empty yet.
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        ) : messages.length === 0 && thinking ? (
          <Stack gap="sm" py="xs">
            <Thinking />
          </Stack>
        ) : messages.length === 0 ? (
          <EmptyState
            title="Ask anything about the household"
            description="Tasks, the calendar, who is doing what. The assistant can look things up and make changes for you."
          />
        ) : (
          <Stack gap="sm" py="xs">
            {messages.map((message) => (
              <AskMessage key={message.id} message={message} />
            ))}
            {thinking && <Thinking />}
          </Stack>
        )}
      </ScrollArea>
      <Stack gap={4} pt="sm">
        {readOnly ? (
          <Text size="xs" c="dimmed">
            This conversation is archived: it can be read but not continued.
          </Text>
        ) : (
          <AskComposer
            disabled={isStreaming || status === "error"}
            placeholder={status === "error" ? "Disconnected" : undefined}
            onSend={(text) => {
              ask(text);
              return true;
            }}
            onNew={onNew}
          />
        )}
      </Stack>
    </>
  );
}
