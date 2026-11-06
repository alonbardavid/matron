import { oc } from "@orpc/contract";
import { z } from "zod";

export const BRANCH_STATUSES = [
  "deploying",
  "ready",
  "merging",
  "merged",
  "abandoned",
] as const;

export const branchSchema = z.object({
  id: z.string(),
  name: z.string(),
  previewName: z.string(),
  previewUrl: z.string().nullable(),
  buildSessionId: z.string(),
  /** False once the session was cleared: there is no chat left to view. */
  sessionViewable: z.boolean(),
  userId: z.string(),
  userName: z.string(),
  status: z.enum(BRANCH_STATUSES),
  /** Set once merged or abandoned: the branch is history, shown only on request. */
  archivedAt: z.number().nullable(),
  /** Main has moved since the branch last took it in: it must update before it can merge. */
  behindMain: z.boolean(),
  /** The upstream commit the branch merges in, for an origin update; null for a requested change. */
  upstreamCommit: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Branch = z.infer<typeof branchSchema>;

export const branchesContract = {
  // Every branch, archived ones included, and `current`: the branch the request's
  // `?branch=` resolved to ("main" when absent or no longer live).
  list: oc
    .route({ method: "GET", path: "/api/arch/branches" })
    .output(z.object({ current: z.string(), branches: z.array(branchSchema) })),
  // Fails with CONFLICT when main has moved since the branch was cut.
  merge: oc
    .route({ method: "POST", path: "/api/arch/branches/{id}/merge" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ ok: z.literal(true) })),
  // Abandon without merging; same cleanup as a merge.
  remove: oc
    .route({ method: "DELETE", path: "/api/arch/branches/{id}" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ ok: z.literal(true) })),
};
