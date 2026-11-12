import { r2DeletePrefix, wranglerTolerant, type WranglerContext } from "./cloudflare.js";
import * as git from "./git.js";
import type { BuilderRun } from "./types.js";

/** What every cleanup step may use. */
export type CleanupContext = {
  run: BuilderRun;
  wrangler: WranglerContext;
  git: git.GitContext;
  progress: (text: string) => void;
};

/**
 * One thing a finished branch leaves behind. `remove` removes it and reports in
 * the chat; a failure is logged and the next step still runs, since whatever a
 * step could not remove is listed on the Troubleshooting page.
 */
export type CleanupStep = {
  /** The chat line while it runs, from the run. */
  describe: (run: BuilderRun) => string;
  remove: (ctx: CleanupContext) => Promise<void>;
};

/** Leftovers of a merged or abandoned branch, in the order they go. Add a cleanup step here. */
export const CLEANUP_STEPS: CleanupStep[] = [
  {
    describe: (run) => `deleting preview ${run.branch.previewName}`,
    remove: ({ run, wrangler, progress }) =>
      wranglerTolerant(
        wrangler,
        "wrangler preview delete",
        [
          "preview",
          "delete",
          "--name",
          run.branch.previewName,
          "--worker-name",
          run.cloudflare.workerName,
          "--skip-confirmation",
        ],
        progress,
      ).then(() => undefined),
  },
  {
    describe: (run) => `deleting D1 ${run.branch.databaseName}`,
    remove: ({ run, wrangler, progress }) =>
      wranglerTolerant(
        wrangler,
        "wrangler d1 delete",
        ["d1", "delete", run.branch.databaseName, "--skip-confirmation"],
        progress,
      ).then(() => undefined),
  },
  {
    describe: (run) => `deleting remote branch ${run.branch.name}`,
    remove: ({ run, git: g }) => git.deleteRemoteBranch(g, run.branch.name),
  },
  {
    // The branch's files: everything it uploaded lives under `<branch id>/` in the shared bucket.
    describe: (run) =>
      `deleting files under ${run.cloudflare.productionDatabaseName}/${run.branch.id}/`,
    remove: async ({ run, progress }) => {
      const deleted = await r2DeletePrefix(
        run,
        run.cloudflare.productionDatabaseName,
        `${run.branch.id}/`,
      );
      progress(`deleted ${deleted} files`);
    },
  },
];

/** Runs every cleanup step; one that fails is reported and skipped. */
export async function runCleanupSteps(ctx: CleanupContext): Promise<void> {
  for (const cleanupStep of CLEANUP_STEPS) {
    const what = cleanupStep.describe(ctx.run);
    ctx.progress(what);
    try {
      await cleanupStep.remove(ctx);
    } catch (error) {
      ctx.progress(
        `${what} failed: ${error instanceof Error ? error.message : String(error)} (ignored)`,
      );
    }
  }
}
