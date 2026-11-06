import { oc } from "@orpc/contract";
import { z } from "zod";

/** A conversation with the household assistant. Its messages live on the socket, not here. */
export const conversationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string().nullable(),
  /** The branch it was started on, "main" or a branch id: it is continued only there. */
  branch: z.string(),
  /** Set once archived: readable, never continued. */
  archivedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationsContract = {
  list: oc
    .route({ method: "GET", path: "/api/app/conversations" })
    .output(z.array(conversationSchema)),
  create: oc
    .route({ method: "POST", path: "/api/app/conversations" })
    .output(conversationSchema),
  rename: oc
    .route({ method: "PUT", path: "/api/app/conversations/{id}" })
    .input(z.object({ id: z.string(), title: z.string().trim().min(1).max(120) }))
    .output(conversationSchema),
  /** Keeps the conversation readable and ends it. */
  archive: oc
    .route({ method: "POST", path: "/api/app/conversations/{id}/archive" })
    .input(z.object({ id: z.string() }))
    .output(conversationSchema),
};

/** Where the application upgrades an ask session's chat socket. */
export function askSocketPath(sessionId: string): string {
  return `/api/app/ask/${encodeURIComponent(sessionId)}/ws`;
}

/** What a message to the assistant may carry: pictures, PDFs and plain text, read by the model. */
export const ASK_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
] as const;
/** Per file, after the browser has shrunk a picture. */
export const ASK_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ASK_ATTACHMENTS_PER_MESSAGE = 3;
