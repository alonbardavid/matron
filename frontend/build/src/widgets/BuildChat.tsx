import { useEffect, useRef, useState } from "react";
import { Box, Center, Group, Loader, ScrollArea, Stack, Text } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { useChatSocket } from "@frontend/api/socket";
import type { ChatFrame } from "@shared/contract/arch/sessions";
import { EmptyState } from "@frontend/ds/EmptyState";
import { SidePanel } from "@frontend/ds/SidePanel";
import { useBuildChat } from "../BuildChatContext";
import { useCreateSession, useSessions } from "../useSessions";
import { ChatComposer } from "./ChatComposer";
import { ChatMessage } from "./ChatMessage";
import { ConnectionStatus } from "./ConnectionStatus";
import { ProgressGroup } from "./ProgressGroup";
import { SessionStatusBadge } from "./SessionStatusBadge";

const REFRESH_DEBOUNCE_MS = 800;

type ProgressFrame = ChatFrame & { type: "progress" };

/** Consecutive progress frames become one group; everything else stays as is. */
function groupProgress(frames: ChatFrame[]): (ChatFrame | ProgressFrame[])[] {
  const out: (ChatFrame | ProgressFrame[])[] = [];
  for (const frame of frames) {
    const last = out[out.length - 1];
    if (frame.type === "progress") {
      if (Array.isArray(last)) last.push(frame);
      else out.push([frame]);
    } else {
      out.push(frame);
    }
  }
  return out;
}

/** The session has the message and is working on it. */
function Thinking() {
  return (
    <Group gap="xs">
      <Loader size={12} />
      <Text size="xs" c="dimmed">
        thinking
      </Text>
    </Group>
  );
}

export function BuildChat() {
  const { opened, sessionId, close, pending, clearPending, openWithMessage } =
    useBuildChat();
  const { messages, status, synced, phase, send } = useChatSocket(
    opened ? sessionId : null,
  );
  const sessions = useSessions();
  const create = useCreateSession();
  const queryClient = useQueryClient();
  const viewport = useRef<HTMLDivElement>(null);
  const session = sessions.data?.find((item) => item.id === sessionId) ?? null;
  const archived = session?.archivedAt != null;
  // A draft has no session yet; the first message creates one and is sent to it.
  const draft = sessionId === null;
  // The first message, shown while its session is being created.
  const [starting, setStarting] = useState<string | null>(null);
  // True from the moment a message is sent until the session answers with anything.
  const [awaiting, setAwaiting] = useState(false);

  const startSession = (text: string): boolean => {
    setStarting(text);
    create
      .mutateAsync(undefined)
      .then((created) => openWithMessage(created.id, text))
      .catch((err: unknown) => notifyError(err, "Could not start the session"))
      .finally(() => setStarting(null));
    return true;
  };

  const sendAndWait = (text: string): boolean => {
    const sent = send(text);
    if (sent) setAwaiting(true);
    return sent;
  };

  useEffect(() => {
    if (status !== "open" || !pending || pending.sessionId !== sessionId) return;
    if (send(pending.text)) {
      setAwaiting(true);
      clearPending();
    }
  }, [status, pending, sessionId, send, clearPending]);

  useEffect(() => {
    setAwaiting(false);
  }, [sessionId]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last && !(last.type === "message" && last.role === "user")) setAwaiting(false);
  }, [messages]);

  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
    const last = messages[messages.length - 1];
    if (last?.type !== "message") return;
    // A message may have changed the session or a branch: the user's starts work,
    // the planner's or builder's ends a step.
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: orpc.sessions.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.branches.key() });
    }, REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [messages, queryClient]);

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
              {/* The object's phase arrives as it changes; the row catches up on the next refetch. */}
              <SessionStatusBadge status={phase ?? session.status} archived={archived} />
            </Box>
          )}
        </Group>
      }
    >
      {!archived && !draft && (
        <Group mb="xs">
          <ConnectionStatus status={status} />
        </Group>
      )}
      <ScrollArea flex={1} viewportRef={viewport} type="auto" offsetScrollbars>
        {!synced && !draft ? (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        ) : starting ? (
          <Stack gap="sm" py="xs">
            <ChatMessage
              frame={{
                type: "message",
                id: "draft",
                ts: Date.now(),
                role: "user",
                text: starting,
              }}
            />
            <Thinking />
          </Stack>
        ) : messages.length === 0 ? (
          <EmptyState
            title="What would you like to change?"
            description="Describe the change in plain words. The planner asks questions when it needs to, then hands the plan to the builder, which usually takes five to ten minutes."
          />
        ) : (
          <Stack gap="sm" py="xs">
            {groupProgress(messages).map((item) =>
              Array.isArray(item) ? (
                <ProgressGroup
                  key={item[0]?.id}
                  frames={item}
                  // Work is in progress while progress is the newest thing in the
                  // transcript: a reply or a failure always follows as a message.
                  live={
                    item[item.length - 1] === messages[messages.length - 1] && !archived
                  }
                />
              ) : (
                <ChatMessage key={item.id} frame={item} />
              ),
            )}
            {awaiting && <Thinking />}
          </Stack>
        )}
      </ScrollArea>
      <Stack gap={4} pt="sm">
        <ChatComposer
          disabled={draft ? create.isPending : status !== "open" || archived}
          onSend={draft ? startSession : sendAndWait}
        />
        <Text size="xs" c="dimmed">
          {archived
            ? "This session is archived: it can be read but not continued."
            : draft
              ? "Your first message starts the session. Enter sends, Shift+Enter adds a line."
              : "Enter sends, Shift+Enter adds a line."}
        </Text>
      </Stack>
    </SidePanel>
  );
}
