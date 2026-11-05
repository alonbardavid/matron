import { oc } from "@orpc/contract";
import { z } from "zod";

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
