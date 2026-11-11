import { oc } from "@orpc/contract";
import { z } from "zod";

/** The upstream repository Matron is released from, against this deployment's main. Owners only. */
export const upstreamContract = {
  /** Pulls upstream into the deployment's `upstream/main` branch and says whether main has all of it. */
  check: oc
    .route({ method: "POST", path: "/api/arch/upstream/check" })
    .output(z.object({ upToDate: z.boolean() })),
  /**
   * Starts a build session whose branch merges what the last check pulled; it
   * then runs like any build: a Preview, follow-ups in its chat, and a merge
   * from the branch menu. CONFLICT when nothing was pulled yet or an upstream
   * update is already open.
   */
  merge: oc
    .route({ method: "POST", path: "/api/arch/upstream/merge" })
    .output(z.object({ sessionId: z.string(), branchId: z.string() })),
};
