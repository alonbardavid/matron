import { oc } from "@orpc/contract";
import { z } from "zod";
import { branchSchema } from "./branches";

/** Why a section could not be read from Cloudflare. */
export const apiProblemSchema = z.object({
  kind: z.enum(["missing-token", "permission", "error"]),
  message: z.string(),
  /** The token permission the section needs, for a permission problem. */
  permission: z.string().nullable(),
});
export type ApiProblem = z.infer<typeof apiProblemSchema>;

export const databaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["production", "preview"]),
  sizeBytes: z.number(),
  /** What a database may grow to. */
  maxBytes: z.number(),
  tables: z.number().nullable(),
  createdAt: z.number().nullable(),
  /** The branch a Preview database belongs to, while that branch exists. */
  branchName: z.string().nullable(),
});
export type TroubleshootingDatabase = z.infer<typeof databaseSchema>;

export const containerSchema = z.object({
  id: z.string(),
  /** The instance's name: the build session it serves. */
  name: z.string(),
  state: z.string(),
  running: z.boolean(),
  startedAt: z.number().nullable(),
  lastActivityAt: z.number().nullable(),
  location: z.string().nullable(),
  vcpu: z.number().nullable(),
  memoryMiB: z.number().nullable(),
  diskMB: z.number().nullable(),
  /** What the instance cost so far at most, in dollars, at list prices. */
  costUsd: z.number().nullable(),
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  sessionTitle: z.string().nullable(),
});
export type TroubleshootingContainer = z.infer<typeof containerSchema>;

/** A branch as the owner sees it here: every branch, with who made it and its session. */
export const troubleshootingBranchSchema = branchSchema.extend({
  /** The build session's title: the request it began with. */
  sessionTitle: z.string().nullable(),
});
export type TroubleshootingBranch = z.infer<typeof troubleshootingBranchSchema>;

export const upstreamCommitSchema = z.object({
  sha: z.string(),
  /** The message's first line. */
  title: z.string(),
  author: z.string().nullable(),
  committedAt: z.number().nullable(),
  url: z.string(),
});
export type UpstreamCommit = z.infer<typeof upstreamCommitSchema>;

/** Where this deployment's main stands against the repository Matron is released from. */
export const originStatusSchema = z.object({
  /** "owner/name" on GitHub. */
  repository: z.string(),
  branch: z.string(),
  url: z.string(),
  checkedAt: z.number(),
  /** The upstream branch's head. */
  head: upstreamCommitSchema,
  /** This deployment's main head. */
  mainHead: z.string(),
  /**
   * `behind`: upstream has commits main lacks. `unknown`: main's history is too
   * long to tell within one check; a merge can still be started.
   */
  state: z.enum(["up-to-date", "behind", "unknown"]),
  /** What main lacks, newest first; cut at the first hundred. */
  commits: z.array(upstreamCommitSchema),
  /** There are more than `commits` lists. */
  moreCommits: z.boolean(),
  /** Files the new commits change, when GitHub could compare them. */
  filesChanged: z.number().nullable(),
  /**
   * The update changes the builder image (`apps/builder/`): in-app deploys reuse
   * the published image, so those changes apply after the next deploy from a terminal.
   */
  touchesBuilderImage: z.boolean(),
  /** An origin update branch that is still open; only one runs at a time. */
  pending: z
    .object({
      branchId: z.string(),
      branchName: z.string(),
      buildSessionId: z.string(),
      status: branchSchema.shape.status,
      upstreamCommit: z.string(),
    })
    .nullable(),
});
export type OriginStatus = z.infer<typeof originStatusSchema>;

/** A listing, or the problem that stopped it. */
const listOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), problem: apiProblemSchema.nullable() });

export const doneSchema = z.object({ done: z.boolean() });

/** The deployment's own resources, read live from Cloudflare. Owners only. */
export const troubleshootingContract = {
  databases: {
    list: oc
      .route({ method: "GET", path: "/api/arch/troubleshooting/databases" })
      .output(listOf(databaseSchema)),
    /** A Preview database; the production one is never removed here. */
    remove: oc
      .route({ method: "DELETE", path: "/api/arch/troubleshooting/databases/{id}" })
      .input(z.object({ id: z.string() }))
      .output(doneSchema),
  },
  /** Every branch, archived ones included, with its creator. */
  branches: {
    list: oc
      .route({ method: "GET", path: "/api/arch/troubleshooting/branches" })
      .output(listOf(troubleshootingBranchSchema)),
  },
  /** The upstream repository Matron is released from, against this deployment's main. */
  origin: {
    check: oc
      .route({ method: "POST", path: "/api/arch/troubleshooting/origin/check" })
      .output(
        z.object({
          status: originStatusSchema.nullable(),
          problem: apiProblemSchema.nullable(),
        }),
      ),
    /**
     * Starts a build session whose branch merges upstream `commit` into main's
     * code; it then runs like any build: a Preview, follow-ups in its chat, and
     * a merge from the branch menu. CONFLICT when nothing is new or an origin
     * update is already open.
     */
    merge: oc
      .route({ method: "POST", path: "/api/arch/troubleshooting/origin/merge" })
      .input(z.object({ commit: z.string().regex(/^[0-9a-f]{40}$/) }))
      .output(z.object({ sessionId: z.string(), branchId: z.string() })),
  },
  containers: {
    list: oc
      .route({ method: "GET", path: "/api/arch/troubleshooting/containers" })
      .output(listOf(containerSchema)),
    /** Stops a running instance through its builder, which snapshots the workspace first. */
    stop: oc
      .route({ method: "POST", path: "/api/arch/troubleshooting/containers/{name}/stop" })
      .input(z.object({ name: z.string() }))
      .output(doneSchema),
    /** Stops every running instance. Stopped ones stay listed until Cloudflare lets them go. */
    clear: oc
      .route({ method: "POST", path: "/api/arch/troubleshooting/containers/clear" })
      .output(doneSchema),
  },
};
