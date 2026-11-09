import { oc } from "@orpc/contract";
import { z } from "zod";

export const BUILD_SESSION_STATUSES = [
  "planning",
  "building",
  "waiting",
  "deployed",
  "failed",
  "timed_out",
  "closed",
  "merged",
  "abandoned",
] as const;

export const buildSessionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string().nullable(),
  /** The last status; archiving keeps it. */
  status: z.enum(BUILD_SESSION_STATUSES),
  branchId: z.string().nullable(),
  /** Set once archived: hidden by default, viewable, never continued. */
  archivedAt: z.number().nullable(),
  /** Set once cleared: the transcript is gone, only this row remains. */
  clearedAt: z.number().nullable(),
  /** Whether the caller may archive it now (nothing running, no live branch). */
  canArchive: z.boolean(),
  /** Whether the caller may clear it now (archived, not yet cleared). */
  canClear: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type BuildSession = z.infer<typeof buildSessionSchema>;

/** The sessions themselves, over HTTP. */
export const sessionsContract = {
  list: oc
    .route({ method: "GET", path: "/api/arch/sessions" })
    .output(z.array(buildSessionSchema)),
  create: oc
    .route({ method: "POST", path: "/api/arch/sessions" })
    .output(buildSessionSchema),
  // Hides the session and closes its chat for good. Merged and abandoned sessions archive themselves.
  archive: oc
    .route({ method: "POST", path: "/api/arch/sessions/{id}/archive" })
    .input(z.object({ id: z.string() }))
    .output(buildSessionSchema),
  // Wipes an archived session's transcript and builder state; the row stays, unreadable.
  clear: oc
    .route({ method: "POST", path: "/api/arch/sessions/{id}/clear" })
    .input(z.object({ id: z.string() }))
    .output(buildSessionSchema),
};

// ── The build chat, over the session's WebSocket ──────────────────────────────

/**
 * What the session is doing, synced to every connected client as it changes.
 * A session plans until a build starts, then follows the builder; a closed
 * session (archived, merged or abandoned) answers nothing more.
 */
export const BUILD_PHASES = [
  "planning",
  "building",
  "waiting",
  "deployed",
  "failed",
  "timed_out",
  "closed",
] as const;
export type BuildPhase = (typeof BUILD_PHASES)[number];

/**
 * The chat itself is the agent's conversation, carried by the Agents SDK chat
 * protocol: the member's messages, the planner's answers with the tools it
 * called, and the builder's words. A builder message is kept on the member's
 * side of the conversation, marked by its metadata, so the planner reads it
 * as something said to it rather than something it said.
 */
export const buildMessageMetadataSchema = z.object({
  author: z.literal("builder").optional(),
});
export type BuildMessageMetadata = z.infer<typeof buildMessageMetadataSchema>;

/** Prefixed to a builder message's text in the transcript; the chat shows the text without it. */
export const BUILDER_SAYS = "The builder says:\n\n";

/**
 * A line of what the builder is doing, streamed from its run as a data part
 * of this type: a step, a thought, a tool call, the coding agent's words, or
 * with `kind` "log" a run of command output.
 */
export const BUILD_LINE_PART = "data-build-line";
export const buildLineSchema = z.object({
  text: z.string(),
  kind: z.enum(["step", "log", "agent", "thought", "tool"]),
  ts: z.number(),
});
export type BuildLine = z.infer<typeof buildLineSchema>;

/** Where the router upgrades a session's chat socket. */
export function sessionSocketPath(sessionId: string): string {
  return `/api/arch/sessions/${encodeURIComponent(sessionId)}/ws`;
}
