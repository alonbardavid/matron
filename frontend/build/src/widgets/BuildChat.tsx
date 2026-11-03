import { useEffect, useRef } from "react";
import { Center, Drawer, Group, Loader, ScrollArea, Stack, Text } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { useChatSocket } from "@frontend/api/socket";
import type { ChatFrame } from "@shared/contract/arch/sessions";
import { EmptyState } from "@frontend/ds/EmptyState";
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

  const startSession = (text: string): boolean => {
    create
      .mutateAsync(undefined)
      .then((created) => openWithMessage(created.id, text))
      .catch((err: unknown) => notifyError(err, "Could not start the session"));
    return true;
  };

  useEffect(() => {
    if (status !== "open" || !pending || pending.sessionId !== sessionId) return;
    if (send(pending.text)) clearPending();
  }, [status, pending, sessionId, send, clearPending]);

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
    <Drawer
      opened={opened}
      onClose={close}
      position="right"
      size={440}
      withOverlay={false}
      lockScroll={false}
      trapFocus={false}
      closeOnClickOutside={false}
      shadow="xl"
      padding="md"
      title={
        <Group gap="sm">
          <Text fw={600}>{draft ? "New session" : (session?.title ?? "Build")}</Text>
          {session && (
            // The object's phase arrives as it changes; the row catches up on the next refetch.
            <SessionStatusBadge status={phase ?? session.status} archived={archived} />
          )}
        </Group>
      }
      styles={{
        content: { display: "flex", flexDirection: "column" },
        body: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
      }}
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
        ) : messages.length === 0 ? (
          <EmptyState
            title="What would you like to change?"
            description="Describe the change in plain words. The planner asks questions when it needs to, then hands the plan to the builder."
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
          </Stack>
        )}
      </ScrollArea>
      <Stack gap={4} pt="sm">
        <ChatComposer
          disabled={draft ? create.isPending : status !== "open" || archived}
          onSend={draft ? startSession : send}
        />
        <Text size="xs" c="dimmed">
          {archived
            ? "This session is archived: it can be read but not continued."
            : draft
              ? "Your first message starts the session. Enter sends, Shift+Enter adds a line."
              : "Enter sends, Shift+Enter adds a line."}
        </Text>
      </Stack>
    </Drawer>
  );
}
