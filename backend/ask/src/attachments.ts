import type { ModelMessage } from "ai";

/** Whether the model message carries a file. */
export function carriesFile(message: ModelMessage | undefined): boolean {
  return (
    typeof message?.content !== "string" &&
    (message?.content ?? []).some((part) => part.type === "file")
  );
}

/** The names of the files in a user's model message, for a title. */
export function fileNames(message: ModelMessage | undefined): string[] {
  if (typeof message?.content === "string") return [];
  return (message?.content ?? []).flatMap((part) =>
    part.type === "file" ? [part.filename ?? part.mediaType] : [],
  );
}
