import { Box, Group, Paper, Stack, Text } from "@mantine/core";
import type { FileUIPart, UIMessage } from "ai";
import { Markdown } from "@frontend/ds/Markdown";
import { palette } from "@frontend/ds/palette";
import { attachmentNote } from "../attachments";
import { AttachmentChip } from "./AttachmentChip";

const TOOL_LABELS: Record<string, string> = {
  list_tasks: "looking at the tasks",
  create_task: "adding a task",
  update_task: "updating a task",
  remove_task: "removing a task",
  list_events: "looking at the calendar",
  get_event: "looking at an event",
  create_event: "adding an event",
  update_event: "updating an event",
  edit_occurrence: "changing one occurrence",
  cancel_occurrence: "removing one occurrence",
  stop_recurrence: "stopping a repetition",
  remove_event: "removing an event",
  list_household_members: "checking who is in the household",
  query_database: "looking something up",
};

/** One message of the assistant's chat: the user's text, or the assistant's text and what it did. */
export function AskMessage({ message }: { message: UIMessage }) {
  if (message.role === "user") {
    const texts: string[] = [];
    const files: FileUIPart[] = [];
    const notes: { name: string }[] = [];
    for (const part of message.parts) {
      if (part.type === "file") files.push(part);
      else if (part.type === "text") {
        const note = attachmentNote(part.text);
        if (note) notes.push(note);
        else texts.push(part.text);
      }
    }
    const text = texts.join("");
    return (
      <Box ml="15%" style={{ alignSelf: "flex-end" }}>
        <Paper bg={palette.bubbleUser} c={palette.bubbleUserText} px="sm" py="xs">
          <Stack gap="xs">
            {files.map((file, index) =>
              file.mediaType.startsWith("image/") ? (
                <img
                  key={index}
                  src={file.url}
                  alt={file.filename ?? "picture"}
                  style={{ maxWidth: "100%", maxHeight: 240, borderRadius: 4, display: "block" }}
                />
              ) : (
                <AttachmentChip key={index} name={file.filename ?? file.mediaType} />
              ),
            )}
            {notes.map((note, index) => (
              <AttachmentChip key={`note-${index}`} name={note.name} gone />
            ))}
            {text && <Markdown text={text} />}
          </Stack>
        </Paper>
      </Box>
    );
  }
  const lines: string[] = [];
  const texts: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text") texts.push(part.text);
    else if (part.type.startsWith("tool-")) {
      const name = part.type.slice("tool-".length);
      lines.push(TOOL_LABELS[name] ?? `using ${name}`);
    }
  }
  const text = texts.join("");
  return (
    <Box mr="10%">
      {lines.length > 0 && (
        <Group gap={6} mb={4}>
          <Text size="xs" c="dimmed">
            {lines.join(", ")}
          </Text>
        </Group>
      )}
      {text && (
        <Paper bg={palette.bubbleAgent} withBorder px="sm" py="xs">
          <Markdown text={text} />
        </Paper>
      )}
    </Box>
  );
}
