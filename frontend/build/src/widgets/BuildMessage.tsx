import { Box, Group, Paper, Stack, Text } from "@mantine/core";
import type { AgentToolRunState } from "agents";
import { getToolName, isToolUIPart, type FileUIPart, type UIMessage } from "ai";
import { BUILDER_SAYS, type BuildMessageMetadata } from "@shared/contract/arch/sessions";
import { attachmentNote } from "@frontend/ds/chat/attachments";
import { AttachmentChip } from "@frontend/ds/chat/AttachmentChip";
import { Markdown } from "@frontend/ds/Markdown";
import { palette } from "@frontend/ds/palette";
import { BuilderRunCard } from "./BuilderRunCard";
import { TimeAgo } from "./TimeAgo";

/** Tool calls that start a run of the builder; the run shows beside them. */
const RUN_TOOLS = new Set(["start_build", "tell_builder"]);

interface BuildMessageProps {
  message: UIMessage;
  /** The builder runs a tool call started, by its id. */
  runsFor: (toolCallId: string) => AgentToolRunState[];
}

/**
 * One message of the build chat: the member's words, the builder's (kept as
 * said to the planner, shown as the builder's), or the planner's reply and
 * the builder runs it started. What the planner did on the way is its own
 * business and is not shown.
 */
export function BuildMessage({ message, runsFor }: BuildMessageProps) {
  const metadata = message.metadata as BuildMessageMetadata | undefined;
  if (message.role === "user" && metadata?.author === "builder") {
    const text = message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .replace(BUILDER_SAYS, "");
    return <AgentBubble label="Builder" text={text} at={metadata.createdAt} />;
  }
  if (message.role === "user") {
    return <MemberBubble message={message} at={metadata?.createdAt} />;
  }
  const runs: AgentToolRunState[] = [];
  const texts: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text") texts.push(part.text);
    else if (isToolUIPart(part) && RUN_TOOLS.has(getToolName(part))) {
      runs.push(...runsFor(part.toolCallId));
    }
  }
  return (
    <>
      <AgentBubble label="Planner" text={texts.join("")} at={metadata?.createdAt} />
      {runs.map((run) => (
        <BuilderRunCard key={run.runId} run={run} />
      ))}
    </>
  );
}

/** Who said it and, when the message says so, how long ago. */
function AgentBubble({ label, text, at }: { label: string; text: string; at?: number }) {
  if (!text) return null;
  return (
    <Box mr="10%">
      <Group gap={6} mb={2} wrap="nowrap">
        <Text size="xs" c="dimmed" fw={600}>
          {label}
        </Text>
        {at !== undefined && <TimeAgo ts={at} />}
      </Group>
      {text && (
        <Paper bg={palette.bubbleAgent} withBorder px="sm" py="xs">
          <Markdown text={text} />
        </Paper>
      )}
    </Box>
  );
}

function MemberBubble({ message, at }: { message: UIMessage; at?: number }) {
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
      {at !== undefined && (
        <Group justify="flex-end" mb={2}>
          <TimeAgo ts={at} />
        </Group>
      )}
      <Paper bg={palette.bubbleUser} c={palette.bubbleUserText} px="sm" py="xs">
        <Stack gap="xs">
          {files.map((file, index) =>
            file.mediaType.startsWith("image/") ? (
              <img
                key={index}
                src={file.url}
                alt={file.filename ?? "picture"}
                style={{
                  maxWidth: "100%",
                  maxHeight: 240,
                  borderRadius: 4,
                  display: "block",
                }}
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
