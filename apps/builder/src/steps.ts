import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runCleanupSteps } from "./cleanup-steps.js";
import {
  deployPreview,
  deployProduction,
  wranglerContext,
  type DeployContext,
} from "./deploy.js";
import { log, progress } from "./emit.js";
import * as git from "./git.js";
import { combined, describeFailure, exec, tail } from "./exec.js";
import {
  readGitAuth,
  readInstalled,
  writeGitAuth,
  writeInstalled,
  type Paths,
} from "./state.js";
import {
  BuilderError,
  type BuilderRun,
  type CommitPushResult,
  type DeployResult,
  type MergeMainResult,
  type PrepareContinueResult,
  type StepInput,
  type VerifyResult,
} from "./types.js";

/** One line for the chat and the agent about where the branch stands against main. */
export function describeFetch(behind: number): string {
  if (behind === 0)
    return "The branch already contains everything on main; nothing to merge.";
  return (
    `origin/main has ${behind} commit${behind === 1 ? "" : "s"} that the branch lacks. ` +
    "Merge them first with `git merge origin/main`."
  );
}

function lockfileHash(repo: string): string | null {
  const file = `${repo}/pnpm-lock.yaml`;
  if (!existsSync(file)) return null;
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * The dev servers the Playwright tests run against, kept warm between runs:
 * the install step starts them, and every run (the agent's and the runner's)
 * reuses them instead of booting its own. The repository's test config reuses
 * listening servers when MATRON_WARM_SERVERS is set.
 */
const DEV_SERVERS: {
  name: string;
  url: string;
  command: string[];
  cwd: string;
  env?: Record<string, string>;
}[] = [
  {
    name: "backend",
    url: "http://localhost:8301/api/arch/health",
    command: ["pnpm", "exec", "vite", "dev"],
    cwd: "apps/backend",
    // No remote bindings: the container holds no Cloudflare credentials.
    env: { WORKER_PERSIST_TO: ".wrangler-test", WORKER_LOCAL_ONLY: "1" },
  },
  {
    name: "frontend",
    url: "http://localhost:5173",
    command: ["pnpm", "--filter", "@app/frontend", "dev"],
    cwd: ".",
  },
];
const SERVER_START_TIMEOUT_MS = 120_000;

const VERIFICATION: { label: string; args: string[] }[] = [
  { label: "pnpm type-check", args: ["type-check"] },
  { label: "pnpm build", args: ["build"] },
  { label: "pnpm test", args: ["test"] },
];

/**
 * The steps the BuilderObject runs, one harness turn each, in the order it
 * decides. Every step gets the run on stdin and reports through stdout
 * lines; what the next step needs is left in /work/state.
 */
export class Steps {
  constructor(
    private readonly run: BuilderRun,
    private readonly paths: Paths,
  ) {}

  private gitContext(): git.GitContext {
    return {
      repo: this.paths.repo,
      token: this.run.repository.token,
      scheme: readGitAuth(this.paths),
      onOutput: log,
    };
  }

  private deployContext(): DeployContext {
    return {
      run: this.run,
      paths: this.paths,
      gitScheme: readGitAuth(this.paths),
      log: progress,
      onOutput: log,
    };
  }

  /** Clones the repository and remembers which auth scheme the remote accepted. */
  private async clone(): Promise<git.GitContext> {
    const g = this.gitContext();
    progress(`cloning into ${this.paths.repo}`);
    await git.clone(g, this.run.repository.remote, dirname(this.paths.repo));
    if (g.scheme) writeGitAuth(this.paths, g.scheme);
    return g;
  }

  /** A build: a fresh clone with the branch cut from main. */
  async prepareBuild(): Promise<void> {
    const g = await this.clone();
    await git.checkoutNewBranch(g, this.run.branch.name, this.run.branch.baseCommit);
  }

  /**
   * A continuation: the restored checkout, or a fresh clone of the branch
   * when there is none. Main is fetched so the agent can merge it.
   */
  async prepareContinue(): Promise<PrepareContinueResult> {
    let g: git.GitContext;
    if (existsSync(`${this.paths.repo}/.git`)) {
      g = this.gitContext();
      await git.configureIdentity(g);
      log(`restored checkout:\n${tail(await git.status(g), 20)}`);
    } else {
      g = await this.clone();
      await git.checkoutRemoteBranch(g, this.run.branch.name);
    }
    progress("fetching main");
    const { behind } = await git.fetchMain(g);
    const sync = describeFetch(behind);
    progress(sync);
    return { sync };
  }

  /** Before a cleanup without a checkout: wrangler comes from the repository's dependencies. */
  async prepareCleanup(): Promise<void> {
    if (existsSync(`${this.paths.repo}/node_modules`)) return;
    if (!existsSync(`${this.paths.repo}/.git`)) await this.clone();
    await this.install();
  }

  /** Installs when nothing is installed yet, or the lockfile changed since the last install. */
  async install(): Promise<void> {
    const hash = lockfileHash(this.paths.repo);
    if (
      existsSync(`${this.paths.repo}/node_modules`) &&
      hash !== null &&
      hash === readInstalled(this.paths)
    ) {
      return;
    }
    progress("installing dependencies");
    const options = {
      cwd: this.paths.repo,
      timeoutMs: 15 * 60 * 1000,
      onOutput: log,
      env: { CI: "true" },
    };
    const frozen = await exec("pnpm", ["install", "--frozen-lockfile"], options);
    if (frozen.code !== 0) {
      progress("frozen install failed; retrying without --frozen-lockfile");
      const loose = await exec("pnpm", ["install"], options);
      if (loose.code !== 0)
        throw new BuilderError(
          describeFailure("pnpm install", loose),
          tail(combined(loose)),
        );
    }
    writeInstalled(this.paths, lockfileHash(this.paths.repo));
  }

  /** Starts whichever dev server is not answering, detached from this step, and waits until both answer. */
  async warmServers(): Promise<void> {
    const logs = join(this.paths.state, "servers");
    mkdirSync(logs, { recursive: true });
    let started = false;
    for (const server of DEV_SERVERS) {
      if (await responds(server.url)) continue;
      if (!started) progress("starting the dev servers");
      started = true;
      const out = openSync(join(logs, `${server.name}.log`), "a");
      const child = spawn(server.command[0]!, server.command.slice(1), {
        cwd: join(this.paths.repo, server.cwd),
        env: { ...process.env, ...server.env, MATRON_WARM_SERVERS: "1" },
        detached: true,
        stdio: ["ignore", out, out],
      });
      child.unref();
    }
    if (!started) return;
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    for (const server of DEV_SERVERS) {
      while (!(await responds(server.url))) {
        if (Date.now() > deadline) {
          const file = join(logs, `${server.name}.log`);
          throw new BuilderError(
            `The ${server.name} dev server did not start.`,
            existsSync(file) ? tail(readFileSync(file, "utf8"), 40) : undefined,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    progress("dev servers ready");
  }

  async verify(): Promise<VerifyResult> {
    await this.warmServers();
    for (const step of VERIFICATION) {
      progress(`running ${step.label}`);
      const result = await exec("pnpm", step.args, {
        cwd: this.paths.repo,
        timeoutMs: 20 * 60 * 1000,
        onOutput: log,
        env: { CI: "true", MATRON_WARM_SERVERS: "1" },
      });
      if (result.code !== 0) {
        return { failure: { label: step.label, output: tail(combined(result), 150) } };
      }
    }
    return { failure: null };
  }

  async commitPush(input: StepInput): Promise<CommitPushResult> {
    const g = this.gitContext();
    const message = git.formatCommitMessage(
      input.summary,
      input.request,
      input.reasoning,
      input.review,
    );
    const committed = await git.commitAll(g, message);
    progress(committed ? "committed" : "no file changes to commit");
    await git.push(g, this.run.branch.name);
    return { committed };
  }

  async deployPreview(): Promise<DeployResult> {
    return deployPreview(this.deployContext());
  }

  /** Fast-forwards main onto the branch and pushes it; fails when main has diverged. */
  async mergeMain(): Promise<MergeMainResult> {
    const g = await this.clone();
    await git.checkout(g, "main");
    await git.fetch(g, this.run.branch.name);
    if (!(await git.mergeFastForward(g, `origin/${this.run.branch.name}`))) {
      throw new BuilderError("main has diverged");
    }
    await git.push(g, "main");
    progress("main pushed");
    return { headCommit: await git.revParse(g) };
  }

  async deployProduction(): Promise<void> {
    await deployProduction(this.deployContext());
  }

  /** Removes what the branch leaves behind (`cleanup-steps.ts` lists the cleanup steps); each tolerates failure. */
  async cleanup(): Promise<void> {
    await runCleanupSteps({
      run: this.run,
      wrangler: wranglerContext(this.deployContext()),
      git: this.gitContext(),
      progress,
    });
  }
}

async function responds(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.status < 500;
  } catch {
    return false;
  }
}
