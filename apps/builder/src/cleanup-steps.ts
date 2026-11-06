import { r2DeletePrefix, wranglerTolerant, type WranglerContext } from "./cloudflare.js";
import * as git from "./git.js";
import type { BuilderJob } from "./types.js";

/** What every cleanup step may use. */
export type CleanupContext = {
  job: BuilderJob;
  wrangler: WranglerContext;
  git: git.GitContext;
  progress: (text: string) => void;
};

/**
 * One thing a finished branch leaves behind. `run` removes it and reports in
 * the chat; a failure is logged and the next step still runs, since whatever a
 * step could not remove is listed on the Troubleshooting page.
 */
export type CleanupStep = {
  /** The chat line while it runs, from the job. */
  describe: (job: BuilderJob) => string;
  run: (ctx: CleanupContext) => Promise<void>;
};

/** Leftovers of a merged or abandoned branch, in the order they go. Add a cleanup step here. */
export const CLEANUP_STEPS: CleanupStep[] = [
  {
    describe: (job) => `deleting preview ${job.branch.previewName}`,
    run: ({ job, wrangler, progress }) =>
      wranglerTolerant(
        wrangler,
        "wrangler preview delete",
        [
          "preview",
          "delete",
          "--name",
          job.branch.previewName,
          "--worker-name",
          job.cloudflare.workerName,
          "--skip-confirmation",
        ],
        progress,
      ).then(() => undefined),
  },
  {
    describe: (job) => `deleting D1 ${job.branch.databaseName}`,
    run: ({ job, wrangler, progress }) =>
      wranglerTolerant(
        wrangler,
        "wrangler d1 delete",
        ["d1", "delete", job.branch.databaseName, "--skip-confirmation"],
        progress,
      ).then(() => undefined),
  },
  {
    describe: (job) => `deleting remote branch ${job.branch.name}`,
    run: ({ job, git: g }) => git.deleteRemoteBranch(g, job.branch.name),
  },
  {
    // The branch's files: everything it uploaded lives under `<branch id>/` in the shared bucket.
    describe: (job) =>
      `deleting files under ${job.cloudflare.productionDatabaseName}/${job.branch.id}/`,
    run: async ({ job, progress }) => {
      const deleted = await r2DeletePrefix(
        job,
        job.cloudflare.productionDatabaseName,
        `${job.branch.id}/`,
      );
      progress(`deleted ${deleted} files`);
    },
  },
];

/** Runs every cleanup step; one that fails is reported and skipped. */
export async function runCleanupSteps(ctx: CleanupContext): Promise<void> {
  for (const cleanupStep of CLEANUP_STEPS) {
    const what = cleanupStep.describe(ctx.job);
    ctx.progress(what);
    try {
      await cleanupStep.run(ctx);
    } catch (error) {
      ctx.progress(
        `${what} failed: ${error instanceof Error ? error.message : String(error)} (ignored)`,
      );
    }
  }
}
