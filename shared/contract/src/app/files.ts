import { oc } from "@orpc/contract";
import { z } from "zod";

/** Uploaded files: where one is served from, and what a picture may be. */

export function filePath(fileId: string): string {
  return `/api/app/files/${fileId}`;
}

export const filesContract = {
  /** A file's bytes, inline with its type, for a member who may see it. The browser loads the path. */
  get: oc
    .route({ method: "GET", path: "/api/app/files/{id}" })
    .input(z.object({ id: z.string() }))
    .output(z.instanceof(ReadableStream)),
};

/** Pictures only: SVG can carry script, so it is never accepted. */
export const PICTURE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export type PictureMimeType = (typeof PICTURE_MIME_TYPES)[number];

export const MAX_PICTURE_BYTES = 5 * 1024 * 1024;
