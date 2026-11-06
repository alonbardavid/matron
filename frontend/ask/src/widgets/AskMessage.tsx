import { Box, Group, Paper, Text } from "@mantine/core";
import type { UIMessage } from "ai";
import { Markdown } from "@frontend/ds/Markdown";
import { palette } from "@frontend/ds/palette";

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
    const text = message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
    return (
      <Box ml="15%" style={{ alignSelf: "flex-end" }}>
        <Paper bg={palette.bubbleUser} c={palette.bubbleUserText} px="sm" py="xs">
          <Text
            size="sm"
            c="inherit"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {text}
          </Text>
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
