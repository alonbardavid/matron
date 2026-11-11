import { useEffect, useRef, useState } from "react";
import { Alert, Button, Center, Loader, ScrollArea, Stack, Text } from "@mantine/core";
import { useAgentChat } from "@cloudflare/think/react";
import { useAgent, useAgentToolEvents } from "agents/react";
import { useQueryClient } from "@tanstack/react-query";
import { orpc } from "@frontend/api/orpc";
import { ChatComposer } from "@frontend/ds/chat/ChatComposer";
import { EmptyState } from "@frontend/ds/EmptyState";
import { sessionSocketPath, type BuildPhase } from "@shared/contract/arch/sessions";
import type { BuildInput } from "../BuildChatContext";
import { BuildMessage } from "./BuildMessage";
import { BuilderRunCard } from "./BuilderRunCard";
import { Thinking } from "@frontend/ds/chat/Thinking";
import { currentActivity } from "@frontend/ds/chat/activity";

/** What the planner is up to while a tool call of its runs, as the indicator's status. */
const PLANNER_ACTIVITY: Record<string, string> = {
  list_files: "looking at the code",
  read_file: "reading the code",
  search_files: "searching the code",
  propose_plan: "writing the plan down",
  start_build: "handing the plan to the builder",
  tell_builder: "passing it on to the builder",
};

const REFRESH_DEBOUNCE_MS = 800;

interface SessionState {
  phase?: BuildPhase;
}

interface BuildConversationProps {
  sessionId: string;
  /** The session already has messages: they show once the socket replays them. */
  hasHistory: boolean;
  /** Archived: readable, not continued. */
  readOnly: boolean;
  /** Sent once the session is connected, then cleared. */
  pending: BuildInput | null;
  onPendingSent: () => void;
  /** The session's phase, as the object syncs it. */
  onPhase: (phase: BuildPhase | null) => void;
}

/** The chat with the planner for one session, and the builder runs it started, connected while mounted. */
export function BuildConversation({
  sessionId,
  hasHistory,
  readOnly,
  pending,
  onPendingSent,
  onPhase,
}: BuildConversationProps) {
  const agent = useAgent<SessionState>({
    agent: "build-session-object",
    name: sessionId,
    host: window.location.host,
    // The router's own path for the session; it names the object server-side.
    basePath: sessionSocketPath(sessionId).replace(/^\//, ""),
    onStateUpdate: (state) => onPhase(state?.phase ?? null),
  });
  const { messages, sendMessage, status, isStreaming, error, clearError } = useAgentChat({
    agent,
    // The conversation is kept by the object; a turn carries only what was just
    // said, so an attachment crosses the wire once.
    prepareSendMessagesRequest: ({ messages: all }) => ({
      body: { messages: all.slice(-1) },
    }),
  });
  const runs = useAgentToolEvents({ agent });
  const viewport = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  // True from the moment a message is sent until the planner starts answering.
  const [awaiting, setAwaiting] = useState(pending !== null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (isStreaming || error || (last && last.role === "assistant")) setAwaiting(false);
  }, [isStreaming, error, messages]);
  const thinking = awaiting || isStreaming;
  const activity = thinking ? currentActivity(messages, PLANNER_ACTIVITY) : undefined;
  const say = (text: string, files: BuildInput["files"]) => {
    clearError();
    setAwaiting(true);
    void sendMessage({ text, files });
  };
  // The turn failed before an answer came: say so, and offer the last message again.
  const lastMember = [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "user" &&
        (message.metadata as { author?: string } | undefined)?.author !== "builder",
    );
  const lastSaid: BuildInput | null = lastMember
    ? {
        text: lastMember.parts
          .map((part) => (part.type === "text" ? part.text : ""))
          .join(""),
        files: lastMember.parts.filter((part) => part.type === "file"),
      }
    : null;
  const failure = error ? (
    <Alert color="red" title="The planner could not answer" py="xs">
      <Stack gap="xs">
        <Text size="xs">{error.message}</Text>
        {lastSaid && (
          <Button
            size="xs"
            variant="light"
            color="red"
            onClick={() => say(lastSaid.text, lastSaid.files)}
          >
            Try again
          </Button>
        )}
      </Stack>
    </Alert>
  ) : null;

  const runCount = Object.keys(runs.runsById).length;
  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [messages, runCount, thinking, error]);

  // The first message of a new session, sent once the socket is ready.
  const sentPending = useRef(false);
  useEffect(() => {
    if (!pending || sentPending.current || status !== "ready") return;
    sentPending.current = true;
    setAwaiting(true);
    void sendMessage({ text: pending.text, files: pending.files });
    onPendingSent();
  }, [pending, status, sendMessage, onPendingSent]);

  // A message or a run may have changed the session or a branch: the lists catch up.
  useEffect(() => {
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: orpc.sessions.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.branches.key() });
    }, REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [messages.length, runCount, isStreaming, queryClient]);

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
            title="What would you like to change?"
            description="Describe the change in plain words. The planner asks questions when it needs to, then hands the plan to the builder, which usually takes five to ten minutes."
          />
        ) : (
          <Stack gap="sm" py="xs">
            {messages.map((message) => (
              <BuildMessage
                key={message.id}
                message={message}
                runsFor={runs.getRunsForToolCall}
              />
            ))}
            {/* Merges and abandons start from the branch menu, not from a reply: they show last. */}
            {runs.unboundRuns.map((run) => (
              <BuilderRunCard key={run.runId} run={run} />
            ))}
            {failure ?? (thinking && <Thinking status={activity} />)}
          </Stack>
        )}
      </ScrollArea>
      <Stack gap={4} pt="sm">
        {readOnly ? (
          <Text size="xs" c="dimmed">
            This session is archived: it can be read but not continued.
          </Text>
        ) : (
          <ChatComposer
            disabled={isStreaming}
            placeholder="Describe the change you want"
            onSend={(text, files) => {
              say(text, files);
              return true;
            }}
          />
        )}
      </Stack>
    </>
  );
}
