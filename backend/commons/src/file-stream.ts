/**
 * A file's bytes on their way out of a procedure: a plain ReadableStream, which
 * the OpenAPI handler sends as the body, remembered here with what the response
 * headers must say about it. The `fileResponses` middleware looks the stream up.
 */
export interface FileStreamMeta {
  fileName: string;
  mimeType: string;
  size: number;
  etag: string;
}

const META = new WeakMap<ReadableStream, FileStreamMeta>();

/** Tags `body` with its metadata and returns it, to be a procedure's output. */
export function fileStream(body: ReadableStream, meta: FileStreamMeta): ReadableStream {
  META.set(body, meta);
  return body;
}

/** The metadata of a tagged stream, or null for any other output. */
export function fileStreamMeta(output: unknown): FileStreamMeta | null {
  return output instanceof ReadableStream ? (META.get(output) ?? null) : null;
}

/** The headers that serve a file inline, never as anything but bytes of its type. */
export function fileHeaders(meta: FileStreamMeta): Record<string, string> {
  return {
    "Content-Type": meta.mimeType,
    "Content-Length": String(meta.size),
    "Content-Disposition": `inline; filename="${headerSafe(meta.fileName)}"`,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    // A file's id never serves other bytes: a replacement is a new file.
    "Cache-Control": "private, max-age=86400, immutable",
    ETag: meta.etag,
  };
}

function headerSafe(fileName: string): string {
  return fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
}
