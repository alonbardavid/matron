import {
  ActionIcon,
  Alert,
  Box,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ReviewMessage } from "@shared/contract/arch/review";
import { errorMessage } from "@frontend/api/errors";
import { api } from "@frontend/api/orpc";
import { IconSend } from "@frontend/ds/icons";
import { Markdown } from "@frontend/ds/Markdown";
import { palette } from "@frontend/ds/palette";
import { SidePanel } from "@frontend/ds/SidePanel";

interface AskPanelProps {
  branchId: string;
  opened: boolean;
  onClose: () => void;
  messages: ReviewMessage[];
  onMessages: (messages: ReviewMessage[]) => void;
}

/**
 * Questions about the branch, answered by the planner's model reading the
 * code and the builder's commit notes. The conversation lives in the page
 * only: every question sends it whole, and nothing is kept on the server.
 */
export function AskPanel({
  branchId,
  opened,
  onClose,
  messages,
  onMessages,
}: AskPanelProps) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const ask = useMutation({
    mutationFn: (conversation: ReviewMessage[]) =>
      api.review.ask({ id: branchId, messages: conversation }),
    onSuccess: ({ text: answer }, conversation) =>
      onMessages([...conversation, { role: "assistant", text: answer }]),
  });

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, ask.isPending]);

  const send = () => {
    const question = text.trim();
    if (!question || ask.isPending) return;
    const conversation: ReviewMessage[] = [...messages, { role: "user", text: question }];
    onMessages(conversation);
    setText("");
    ask.mutate(conversation);
  };

  return (
    <SidePanel opened={opened} onClose={onClose} title="Ask about this branch">
      <Stack gap="sm" style={{ flex: 1, overflowY: "auto" }} py="sm">
        {messages.length === 0 && (
          <Text size="sm" c="dimmed">
            Ask anything about the code on this branch: why something was done, where a
            behaviour lives, what a change could break. The answers come from the code and
            the builder&apos;s notes on each commit.
          </Text>
        )}
        {messages.map((message, i) =>
          message.role === "user" ? (
            <Paper
              key={i}
              ml="15%"
              px="sm"
              py="xs"
              bg={palette.bubbleUser}
              c={palette.bubbleUserText}
            >
              <Text size="sm" c="inherit" style={{ whiteSpace: "pre-wrap" }}>
                {message.text}
              </Text>
            </Paper>
          ) : (
            <Paper key={i} mr="5%" px="sm" py="xs" withBorder bg={palette.bubbleAgent}>
              <Markdown text={message.text} />
            </Paper>
          ),
        )}
        {ask.isPending && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">
              Reading the code…
            </Text>
          </Group>
        )}
        {ask.isError && (
          <Alert color="red" variant="light" fz="sm">
            {errorMessage(ask.error)}
          </Alert>
        )}
        <Box ref={end} />
      </Stack>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Group gap="xs" align="flex-end" wrap="nowrap" pt="sm">
          <Textarea
            flex={1}
            autosize
            minRows={1}
            maxRows={6}
            placeholder="Ask about the code"
            aria-label="Question"
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <ActionIcon
            type="submit"
            size="lg"
            aria-label="Send"
            disabled={!text.trim() || ask.isPending}
          >
            <IconSend />
          </ActionIcon>
        </Group>
      </form>
    </SidePanel>
  );
}
