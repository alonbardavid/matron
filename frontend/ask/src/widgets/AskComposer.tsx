import { ActionIcon, Tooltip } from "@mantine/core";
import type { FileUIPart } from "ai";
import { ChatComposer } from "@frontend/ds/chat/ChatComposer";
import { IconPlus } from "@frontend/ds/icons";

interface AskComposerProps {
  disabled: boolean;
  placeholder?: string;
  onSend: (text: string, files: FileUIPart[]) => boolean;
  /** Starts an empty conversation; next to the send button. */
  onNew: () => void;
}

export function AskComposer({ disabled, placeholder, onSend, onNew }: AskComposerProps) {
  return (
    <ChatComposer
      disabled={disabled}
      placeholder={placeholder ?? "Ask the household assistant"}
      onSend={onSend}
      extra={
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
      }
    />
  );
}
