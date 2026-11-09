import { Box, Paper, Stack } from "@mantine/core";
import type { FileUIPart, UIMessage } from "ai";
import { Markdown } from "@frontend/ds/Markdown";
import { palette } from "@frontend/ds/palette";
import { attachmentNote } from "@frontend/ds/chat/attachments";
import { AttachmentChip } from "@frontend/ds/chat/AttachmentChip";

/** One message of the assistant's chat: the user's text or the assistant's answer. */
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
  const texts: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text") texts.push(part.text);
  }
  const text = texts.join("");
  if (!text) return null;
  return (
    <Box mr="10%">
      {text && (
        <Paper bg={palette.bubbleAgent} withBorder px="sm" py="xs">
          <Markdown text={text} />
        </Paper>
      )}
    </Box>
  );
}
