import { useRef, useState, type ReactNode } from "react";
import { ActionIcon, Group, Loader, Text, Textarea, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { FileUIPart } from "ai";
import { IconPaperclip, IconSend } from "../icons";
import { ATTACHMENT_ACCEPT, prepareAttachments } from "./attachments";
import { AttachmentChip } from "./AttachmentChip";

interface ChatComposerProps {
  disabled: boolean;
  placeholder: string;
  /** Returns whether the message was taken; the composer then empties. */
  onSend: (text: string, files: FileUIPart[]) => boolean;
  /** Shown after the send button, such as a button for a new conversation. */
  extra?: ReactNode;
  hint?: string;
}

/** A message box with a paperclip: text, pictures, PDFs and text files, Enter to send. */
export function ChatComposer({
  disabled,
  placeholder,
  onSend,
  extra,
  hint = "Enter sends, Shift+Enter adds a line.",
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileUIPart[]>([]);
  const [reading, setReading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const canSend = !disabled && !reading && (text.trim() !== "" || files.length > 0);
  const submit = () => {
    if (!canSend) return;
    if (onSend(text.trim(), files)) {
      setText("");
      setFiles([]);
    }
  };
  const attach = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setReading(true);
    try {
      const prepared = await prepareAttachments([...picked], files.length);
      setFiles((current) => [...current, ...prepared]);
    } catch (err) {
      notifications.show({
        color: "red",
        title: "Could not attach the file",
        message: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      setReading(false);
      if (picker.current) picker.current.value = "";
    }
  };
  return (
    <>
      {files.length > 0 && (
        <Group gap="xs">
          {files.map((file, index) => (
            <AttachmentChip
              key={`${file.filename ?? file.mediaType}-${index}`}
              name={file.filename ?? file.mediaType}
              onRemove={() =>
                setFiles((current) => current.filter((_, i) => i !== index))
              }
            />
          ))}
        </Group>
      )}
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <Textarea
          flex={1}
          autosize
          minRows={1}
          maxRows={6}
          placeholder={placeholder}
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
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          accept={ATTACHMENT_ACCEPT}
          onChange={(event) => void attach(event.currentTarget.files)}
        />
        <Tooltip label="Attach a picture, a PDF or a text file" withArrow>
          <ActionIcon
            size="lg"
            variant="default"
            aria-label="Attach a file"
            disabled={disabled || reading}
            onClick={() => picker.current?.click()}
          >
            {reading ? <Loader size={14} /> : <IconPaperclip />}
          </ActionIcon>
        </Tooltip>
        <ActionIcon size="lg" aria-label="Send" disabled={!canSend} onClick={submit}>
          <IconSend />
        </ActionIcon>
        {extra}
      </Group>
      <Text size="xs" c="dimmed">
        {hint}
      </Text>
    </>
  );
}
