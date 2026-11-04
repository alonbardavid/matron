import { useState } from "react";
import { ActionIcon, Group, Text, Textarea, Tooltip } from "@mantine/core";
import { IconPlus, IconSend } from "@frontend/ds/icons";

interface AskComposerProps {
  disabled: boolean;
  placeholder?: string;
  onSend: (text: string) => boolean;
  /** Starts an empty conversation; next to the send button. */
  onNew: () => void;
}

export function AskComposer({ disabled, placeholder, onSend, onNew }: AskComposerProps) {
  const [text, setText] = useState("");
  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    if (onSend(trimmed)) setText("");
  };
  return (
    <>
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <Textarea
          flex={1}
          autosize
          minRows={1}
          maxRows={6}
          placeholder={placeholder ?? "Ask the household assistant"}
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <ActionIcon
          size="lg"
          aria-label="Send"
          disabled={disabled || !text.trim()}
          onClick={submit}
        >
          <IconSend />
        </ActionIcon>
        <Tooltip label="New conversation" withArrow>
          <ActionIcon
            size="lg"
            variant="default"
            aria-label="New conversation"
            onClick={onNew}
          >
            <IconPlus />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Text size="xs" c="dimmed">
        Enter sends, Shift+Enter adds a line.
      </Text>
    </>
  );
}
