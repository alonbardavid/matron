import { useState } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  FileButton,
  Group,
  Popover,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  type Attachment,
} from "@shared/contract/app/calendar";
import { IconFile, IconLink, IconPaperclip, IconX } from "@frontend/ds/icons";

/** A link to add, before it is added. */
export interface LinkDraft {
  url: string;
  title: string;
}

/** Something attached, or waiting to be once a new event is saved. */
export type AttachmentItem =
  | { state: "attached"; attachment: Attachment }
  | { state: "pending-file"; key: string; file: File }
  | { state: "pending-link"; key: string; link: LinkDraft };

interface AttachmentsFieldProps {
  items: AttachmentItem[];
  /** Whether files and links may be added and the event's own ones removed. */
  canEdit: boolean;
  onAddFiles: (files: File[]) => void | Promise<void>;
  onAddLink: (link: LinkDraft) => void | Promise<void>;
  onRemove: (item: AttachmentItem) => void | Promise<void>;
}

/** Checks a picked file against what an event takes; the message to show, or null. */
export function attachmentProblem(file: File): string | null {
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return `${file.name}: pictures, PDFs, text or office documents only`;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`;
  }
  return null;
}

function AddLink({ onAdd }: { onAdd: (link: LinkDraft) => void | Promise<void> }) {
  const [opened, setOpened] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const valid = /^https?:\/\/\S+\.\S+/i.test(url.trim());
  const add = async () => {
    if (!valid) return;
    await onAdd({ url: url.trim(), title: title.trim() });
    setUrl("");
    setTitle("");
    setOpened(false);
  };
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      shadow="md"
      width={300}
    >
      <Popover.Target>
        <Button
          size="compact-sm"
          variant="subtle"
          leftSection={<IconLink size={14} />}
          onClick={() => setOpened((open) => !open)}
        >
          Add link
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <TextInput
            label="Link"
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            data-autofocus
          />
          <TextInput
            label="Title"
            placeholder="Optional"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
          />
          <Button
            size="compact-sm"
            w="fit-content"
            disabled={!valid}
            onClick={() => void add()}
          >
            Add
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/** An event's attachments: files and links to open, and, for whoever may edit it, to add or remove. */
export function AttachmentsField({
  items,
  canEdit,
  onAddFiles,
  onAddLink,
  onRemove,
}: AttachmentsFieldProps) {
  if (!canEdit && items.length === 0) return null;
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        Attachments
      </Text>
      {items.map((item) => {
        const key = item.state === "attached" ? item.attachment.id : item.key;
        const title =
          item.state === "attached"
            ? item.attachment.title
            : item.state === "pending-file"
              ? item.file.name
              : item.link.title || item.link.url;
        const isFile =
          item.state === "pending-file" ||
          (item.state === "attached" && item.attachment.kind === "file");
        const removable =
          canEdit && (item.state !== "attached" || item.attachment.source === "matron");
        return (
          <Group key={key} gap="xs" wrap="nowrap" role="listitem" aria-label={title}>
            {isFile ? <IconFile size={16} /> : <IconLink size={16} />}
            {item.state === "attached" ? (
              <Anchor
                href={item.attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                size="sm"
                truncate
                style={{ flex: 1, minWidth: 0 }}
              >
                {title}
              </Anchor>
            ) : (
              <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                {title}{" "}
                <Text span size="xs" c="dimmed">
                  · added when saved
                </Text>
              </Text>
            )}
            {item.state === "attached" && item.attachment.source === "google" && (
              <Badge variant="light" color="gray" size="sm">
                Google
              </Badge>
            )}
            {removable && (
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={`Remove ${title}`}
                onClick={() => void onRemove(item)}
              >
                <IconX size={14} />
              </ActionIcon>
            )}
          </Group>
        );
      })}
      {canEdit && (
        <Group gap="xs">
          <FileButton
            multiple
            accept={ATTACHMENT_MIME_TYPES.join(",")}
            onChange={(files) => void onAddFiles(files)}
          >
            {(props) => (
              <Button
                {...props}
                size="compact-sm"
                variant="subtle"
                leftSection={<IconPaperclip size={14} />}
              >
                Attach file
              </Button>
            )}
          </FileButton>
          <AddLink onAdd={onAddLink} />
        </Group>
      )}
    </Stack>
  );
}
