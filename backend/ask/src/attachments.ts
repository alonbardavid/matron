import type { ModelMessage } from "ai";

/** The names of the files in a user's model message, for a title. */
export function fileNames(message: ModelMessage | undefined): string[] {
  if (typeof message?.content === "string") return [];
  return (message?.content ?? []).flatMap((part) =>
    part.type === "file" ? [part.filename ?? part.mediaType] : [],
  );
}
