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

export const CHAT_ROLES = ["user", "planner", "builder"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

/**
 * Everything kept in a session's transcript. `message` from the server has
 * `role` planner or builder and markdown `text`; from the user it is what they
 * typed. `progress` is what the planner or builder is doing right now (a step,
 * a thought, a tool call, or with `kind` "log" a run of command output).
 * `error` is not stored; it tells the client something went wrong.
 */
export const chatFrameSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    id: z.string(),
    ts: z.number(),
    role: z.enum(CHAT_ROLES),
    text: z.string(),
  }),
  z.object({
    type: z.literal("progress"),
    id: z.string(),
    ts: z.number(),
    text: z.string(),
    kind: z.literal("log").optional(),
  }),
  z.object({
    type: z.literal("error"),
    id: z.string(),
    ts: z.number(),
    text: z.string(),
  }),
]);
export type ChatFrame = z.infer<typeof chatFrameSchema>;

/**
 * Sent once per connection, after the transcript replay: the client has
 * everything stored so far and what follows is live. Not kept in the transcript.
 */
export const syncedFrameSchema = z.object({ type: z.literal("synced") });

/** What the server sends: transcript frames and the sync marker. */
export const serverFrameSchema = z.union([chatFrameSchema, syncedFrameSchema]);
export type ServerFrame = z.infer<typeof serverFrameSchema>;

/** What the client sends on the socket: a user message. The server stamps id, ts and role and broadcasts it. */
export const clientFrameSchema = z.object({
  type: z.literal("send"),
  text: z.string().trim().min(1).max(20_000),
});
export type ClientFrame = z.infer<typeof clientFrameSchema>;

/** Where the router upgrades a session's chat socket. */
export function sessionSocketPath(sessionId: string): string {
  return `/api/arch/sessions/${encodeURIComponent(sessionId)}/ws`;
}
