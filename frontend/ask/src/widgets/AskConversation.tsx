import { useEffect, useRef, useState } from "react";
import { Alert, Button, Center, Loader, ScrollArea, Stack, Text } from "@mantine/core";
import { useAgentChat } from "@cloudflare/think/react";
import { useAgent } from "agents/react";
import { useQueryClient } from "@tanstack/react-query";
import { askSocketPath } from "@shared/contract/app/conversations";
import { branchParam } from "@frontend/api/branch";
import { orpc } from "@frontend/api/orpc";
import { EmptyState } from "@frontend/ds/EmptyState";
import type { AskInput } from "../AskChatContext";
import { AskComposer } from "./AskComposer";
import { AskMessage } from "./AskMessage";
import { Thinking } from "@frontend/ds/chat/Thinking";
import { currentActivity } from "@frontend/ds/chat/activity";

/** What the assistant is up to while a tool call of its runs, as the indicator's status. */
const ASSISTANT_ACTIVITY: Record<string, string> = {
  list_tasks: "looking at the tasks",
  create_task: "adding a task",
  update_task: "updating a task",
  remove_task: "removing a task",
  list_events: "looking at the calendar",
  get_event: "looking at an event",
  create_event: "adding an event",
  update_event: "updating an event",
  stop_recurrence: "stopping a repetition",
  remove_event: "removing an event",
  list_household_members: "checking who is in the household",
  query_database: "looking something up",
};

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

interface AskConversationProps {
  sessionId: string;
  /** The conversation already has messages: they show once the socket replays them. */
  hasHistory: boolean;
  /** Archived: readable, not continued. */
  readOnly: boolean;
  /** Sent once the conversation is connected, then cleared. */
  pending: AskInput | null;
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
    // A socket has no referer to read the branch from: it goes on the URL.
    query: branchParam() ? { branch: branchParam() } : undefined,
  });
  const { messages, sendMessage, status, isStreaming, error, clearError } = useAgentChat({
    agent,
    body: { timeZone: TIME_ZONE },
    // The conversation is kept by the object; a turn carries only what was just asked,
    // so an attachment crosses the wire once.
    prepareSendMessagesRequest: ({ messages: all }) => ({
      body: { messages: all.slice(-1) },
    }),
  });
  const viewport = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  // True from the moment a message is sent until the assistant starts answering.
  const [awaiting, setAwaiting] = useState(pending !== null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (isStreaming || error || (last && last.role === "assistant")) setAwaiting(false);
  }, [isStreaming, error, messages]);
  const thinking = awaiting || isStreaming;
  const activity = thinking ? currentActivity(messages, ASSISTANT_ACTIVITY) : undefined;
  const ask = (text: string, files: AskInput["files"]) => {
    clearError();
    setAwaiting(true);
    void sendMessage({ text, files });
  };
  // The turn failed before an answer came: say so, and offer the last question again.
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const lastQuestion: AskInput | null = lastUser
    ? {
        text: lastUser.parts
          .map((part) => (part.type === "text" ? part.text : ""))
          .join(""),
        files: lastUser.parts.filter((part) => part.type === "file"),
      }
    : null;
  const failure = error ? (
    <Alert color="red" title="Failed to contact the assistant" py="xs">
      <Stack gap="xs">
        <Text size="xs">{error.message}</Text>
        {lastQuestion && (
          <Button
            size="xs"
            variant="light"
            color="red"
            onClick={() => ask(lastQuestion.text, lastQuestion.files)}
          >
            Try again
          </Button>
        )}
      </Stack>
    </Alert>
  ) : null;

  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [messages, thinking, error]);

  // The first message of a new conversation, sent once the socket is ready.
  const sentPending = useRef(false);
  useEffect(() => {
    if (!pending || sentPending.current || status !== "ready") return;
    sentPending.current = true;
    setAwaiting(true);
    void sendMessage({ text: pending.text, files: pending.files });
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
        ) : messages.length === 0 && (thinking || failure) ? (
          <Stack gap="sm" py="xs">
            {failure ?? <Thinking />}
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
            {failure ?? (thinking && <Thinking status={activity} />)}
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
            disabled={isStreaming}
            onSend={(text, files) => {
              ask(text, files);
              return true;
            }}
            onNew={onNew}
          />
        )}
      </Stack>
    </>
  );
}
