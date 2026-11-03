import { useState } from "react";
import { ActionIcon, Group, Textarea } from "@mantine/core";
import { IconSend } from "@frontend/ds/icons";

interface ChatComposerProps {
  disabled: boolean;
  onSend: (text: string) => boolean;
}

export function ChatComposer({ disabled, onSend }: ChatComposerProps) {
  const [text, setText] = useState("");

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    if (onSend(trimmed)) setText("");
  };

  return (
    <Group gap="xs" align="flex-end" wrap="nowrap">
      <Textarea
        flex={1}
        autosize
        minRows={1}
        maxRows={6}
        placeholder={
          disabled ? "Waiting for the connection" : "Describe the change you want"
        }
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
    </Group>
  );
}
