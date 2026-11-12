import { ActionIcon, Group, Paper, Text } from "@mantine/core";
import { IconFile, IconX } from "../icons";

interface AttachmentChipProps {
  name: string;
  /** Moved out of the conversation: the assistant no longer sees it. */
  gone?: boolean;
  onRemove?: () => void;
}

/** A file that goes with a message, by name. */
export function AttachmentChip({ name, gone = false, onRemove }: AttachmentChipProps) {
  return (
    <Paper withBorder px="xs" py={4} radius="sm" opacity={gone ? 0.6 : 1}>
      <Group gap={6} wrap="nowrap">
        <IconFile size={14} />
        <Text size="xs" c="inherit" truncate maw={220}>
          {name}
        </Text>
        {gone && (
          <Text size="xs" c="dimmed">
            no longer shown
          </Text>
        )}
        {onRemove && (
          <ActionIcon
            size="xs"
            variant="subtle"
            color="gray"
            aria-label={`Remove ${name}`}
            onClick={onRemove}
          >
            <IconX size={12} />
          </ActionIcon>
        )}
      </Group>
    </Paper>
  );
}
