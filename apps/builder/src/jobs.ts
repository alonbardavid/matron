import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { runAgentTurn } from "./agent.js";
import { r2DeletePrefix, wranglerTolerant } from "./cloudflare.js";
import {
  deployPreview,
  deployProduction,
  wranglerContext,
  type DeployContext,
} from "./deploy.js";
import { EventLog } from "./events.js";
import * as git from "./git.js";
import { loadPrompt, renderTemplate } from "./prompts.js";
import { combined, describeFailure, run, tail } from "./run.js";
import {
  ensureDirs,
  paths,
  readGitAuth,
  readJob,
  readSessionId,
  writeGitAuth,
  writeJob,
  writeSessionId,
  type Paths,
} from "./state.js";
import {
  JobError,
  type AgentOutcome,
  type BuilderJob,
  type BuilderStatus,
} from "./types.js";

export const MAX_FIX_ROUNDS = 3;

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

const VERIFICATION: { label: string; args: string[] }[] = [
  { label: "pnpm type-check", args: ["type-check"] },
  { label: "pnpm build", args: ["build"] },
  { label: "pnpm test", args: ["test"] },
];

/**
 * Runs one job at a time. A job that stops to ask the user stays "waiting":
 * a message on the socket, or a `continue` job while this process is still
 * alive, resumes it in place. After a restore from snapshot the process is new, so a
 * `continue` job rebuilds its context from /work/state.
 */
export class JobRunner {
  readonly events: EventLog;
  readonly paths: Paths;
  private running: Promise<void> | null = null;
  private waiter: ((text: string) => void) | null = null;
  private queued: string[] = [];
  private job: BuilderJob | null = null;
  /** Hash of pnpm-lock.yaml at the last successful install. */
  private installedLockfile: string | null = null;

  constructor(p: Paths = paths()) {
    this.paths = p;
    ensureDirs(p);
    this.events = new EventLog(p.eventsFile);
    this.job = readJob(p);
    // The process restarted mid-job (not a snapshot at a resting status): the
    // Worker will send a continue job; until then there is nothing running.
    if (this.events.status === "building" || this.events.status === "deploying") {
      this.events.setStatus("failed", { error: "The builder restarted while working." });
      this.events.message(
        "The builder restarted while working. Send a message to continue.",
      );
    }
  }

  get status(): BuilderStatus {
    return this.events.status;
  }

  get busy(): boolean {
    return this.running !== null && this.waiter === null;
  }

  /** Accepts a job. Throws when one is already running. */
  submit(job: BuilderJob): void {
    if (this.running && this.waiter && job.mode === "continue") {
      // The job is waiting in this very process: treat the continue as the reply.
      this.job = job;
      writeJob(this.paths, job);
      this.deliver(job.message ?? "");
      return;
    }
    if (this.running) throw new JobError("A job is already running.");
    this.job = job;
    writeJob(this.paths, job);
    this.running = this.execute(job)
      .catch((error: unknown) => this.fail(error))
      .finally(() => {
        this.running = null;
        this.waiter = null;
      });
  }

  /** A user reply: delivered to the waiting turn, else kept for the next one. */
  message(text: string): void {
    this.deliver(text);
  }

  private deliver(text: string): void {
    if (!text.trim()) return;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve(text);
    } else {
      this.queued.push(text);
    }
  }

  private waitForMessage(): Promise<string> {
    const queued = this.queued.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  private takeQueued(): string {
    const text = this.queued.join("\n\n");
    this.queued = [];
    return text;
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const output = error instanceof JobError ? error.output : undefined;
    if (output) this.events.log(output);
    console.error("job failed:", message);
    this.events.message(output ? `${message}\n\n\`\`\`\n${output}\n\`\`\`` : message);
    this.events.setStatus("failed", { error: message });
  }

  private async execute(job: BuilderJob): Promise<void> {
    switch (job.mode) {
      case "build":
        return this.build(job);
      case "continue":
        return this.continue(job);
      case "merge":
        return this.merge(job);
      case "abandon":
        return this.abandon(job);
      default:
        throw new JobError(`Unknown job mode ${(job as { mode: string }).mode}`);
    }
  }

  private gitContext(job: BuilderJob): git.GitContext {
    return {
      repo: this.paths.repo,
      token: job.repository.token,
      scheme: readGitAuth(this.paths),
      onOutput: (text) => this.events.log(text),
    };
  }

  /** Clones the repository and remembers which auth scheme the remote accepted. */
  private async clone(job: BuilderJob): Promise<git.GitContext> {
    const g = this.gitContext(job);
    this.events.progress(`cloning into ${this.paths.repo}`);
    await git.clone(g, job.repository.remote, dirname(this.paths.repo));
    if (g.scheme) writeGitAuth(this.paths, g.scheme);
    return g;
  }

  private deployContext(job: BuilderJob): DeployContext {
    return {
      job,
      paths: this.paths,
      gitScheme: readGitAuth(this.paths),
      log: (text) => this.events.progress(text),
      onOutput: (text) => this.events.log(text),
    };
  }

  // --- build / continue ---------------------------------------------------

  private async build(job: BuilderJob): Promise<void> {
    this.events.setStatus("building");
    const g = await this.clone(job);
    await git.checkoutNewBranch(g, job.branch.name, job.branch.baseCommit);
    await this.install();
    const prompt = renderTemplate(loadPrompt(this.paths.prompts, "build"), {
      request: job.request,
      plan: job.plan ?? "(no plan was written; work from the request)",
      branch: job.branch.name,
      extra: this.takeQueued(),
    });
    await this.develop(job, prompt, null);
  }

  private async continue(job: BuilderJob): Promise<void> {
    this.events.setStatus("building");
    let g: git.GitContext;
    if (existsSync(`${this.paths.repo}/.git`)) {
      g = this.gitContext(job);
      await git.configureIdentity(g);
      this.events.log(`restored checkout:\n${tail(await git.status(g), 20)}`);
    } else {
      // No snapshot to restore (first start without one): check the branch out fresh.
      g = await this.clone(job);
      await git.checkoutRemoteBranch(g, job.branch.name);
    }
    // Main may have moved since the branch was cut. The runner fetches it (the
    // only step that needs the remote); the agent merges the local origin/main.
    this.events.progress("fetching main");
    const { behind } = await git.fetchMain(g);
    const syncNote = describeFetch(behind);
    this.events.progress(syncNote);
    await this.ensureInstalled();
    const text = [job.message ?? "", this.takeQueued()]
      .filter((part) => part.trim())
      .join("\n\n");
    if (!text.trim()) throw new JobError("The continue job carried no message.");
    const sessionId = readSessionId(this.paths);
    let prompt = renderTemplate(loadPrompt(this.paths.prompts, "continue"), {
      message: text,
      sync: syncNote,
    });
    if (!sessionId) {
      // A fresh agent session has no memory of the branch: give it the original context first.
      const context = renderTemplate(loadPrompt(this.paths.prompts, "build"), {
        request: job.request,
        plan:
          job.plan ??
          "(the plan is not available; the branch already contains the earlier work)",
        branch: job.branch.name,
        extra: "",
      });
      prompt = `${context}\n\n---\n\n${prompt}`;
    }
    await this.develop(job, prompt, sessionId);
  }

  /** Installs when nothing is installed yet, or the lockfile changed since the last install. */
  private async ensureInstalled(): Promise<void> {
    const hash = lockfileHash(this.paths.repo);
    if (existsSync(`${this.paths.repo}/node_modules`) && hash === this.installedLockfile)
      return;
    await this.install();
  }

  private async install(): Promise<void> {
    this.events.progress("installing dependencies");
    const frozen = await run("pnpm", ["install", "--frozen-lockfile"], {
      cwd: this.paths.repo,
      timeoutMs: 15 * 60 * 1000,
      onOutput: (text) => this.events.log(text),
      env: { CI: "true" },
    });
    if (frozen.code === 0) {
      this.installedLockfile = lockfileHash(this.paths.repo);
      return;
    }
    this.events.progress("frozen install failed; retrying without --frozen-lockfile");
    const loose = await run("pnpm", ["install"], {
      cwd: this.paths.repo,
      timeoutMs: 15 * 60 * 1000,
      onOutput: (text) => this.events.log(text),
      env: { CI: "true" },
    });
    if (loose.code !== 0)
      throw new JobError(describeFailure("pnpm install", loose), tail(combined(loose)));
    this.installedLockfile = lockfileHash(this.paths.repo);
  }

  /**
   * Agent turns until the agent reports `done`. A question parks the job in
   * "waiting" until a reply arrives and continues the same agent session with
   * it; `blocked` fails the job and returns null.
   */
  private async agentUntilDone(
    job: BuilderJob,
    prompt: string,
    sessionId: string | null,
  ): Promise<{
    outcome: AgentOutcome;
    job: BuilderJob;
    sessionId: string | null;
  } | null> {
    for (;;) {
      const turn = await runAgentTurn(
        job,
        this.paths,
        { prompt, resumeSessionId: sessionId },
        this.events,
      );
      if (turn.sessionId) {
        sessionId = turn.sessionId;
        writeSessionId(this.paths, sessionId);
      }
      if (turn.status === "done") return { outcome: turn, job, sessionId };
      if (turn.status === "blocked") {
        this.events.message(
          turn.message || "The builder could not complete this change.",
        );
        this.events.setStatus("failed", { error: "blocked" });
        return null;
      }
      this.events.message(turn.message || "The builder has a question.");
      this.events.setStatus("waiting");
      const reply = await this.waitForMessage();
      this.job = readJob(this.paths) ?? job;
      job = this.job;
      this.events.setStatus("building");
      prompt = renderTemplate(loadPrompt(this.paths.prompts, "continue"), {
        message: reply,
        // A reply mid-turn: main is fetched once per continuation, at its start.
        sync: "Main was not fetched again for this reply.",
      });
    }
  }

  /**
   * The development loop: agent turns until the agent is done, then
   * verification (with fix rounds, each again until the agent is done), commit,
   * push and deploy.
   */
  private async develop(
    job: BuilderJob,
    firstPrompt: string,
    sessionId: string | null,
  ): Promise<void> {
    const first = await this.agentUntilDone(job, firstPrompt, sessionId);
    if (!first) return;
    let outcome = first.outcome;
    ({ job, sessionId } = first);

    // Verification with fix rounds. A merge of main may have changed the lockfile.
    for (let round = 0; ; round++) {
      await this.ensureInstalled();
      const failure = await this.verify();
      if (!failure) break;
      if (round >= MAX_FIX_ROUNDS) {
        this.events.message(
          `Verification still fails after ${MAX_FIX_ROUNDS} fix attempts (${failure.label}).\n\n\`\`\`\n${failure.output}\n\`\`\``,
        );
        this.events.setStatus("failed", { error: `${failure.label} failed` });
        return;
      }
      this.events.progress(
        `${failure.label} failed; asking the agent to fix it (round ${round + 1}/${MAX_FIX_ROUNDS})`,
      );
      const fixPrompt = renderTemplate(loadPrompt(this.paths.prompts, "fix"), {
        command: failure.label,
        output: failure.output,
      });
      const fixed = await this.agentUntilDone(job, fixPrompt, sessionId);
      if (!fixed) return;
      ({ job, sessionId } = fixed);
      outcome = {
        ...fixed.outcome,
        summary: outcome.summary || fixed.outcome.summary,
        reasoning: outcome.reasoning || fixed.outcome.reasoning,
      };
    }

    // Commit, push, deploy.
    const g = this.gitContext(job);
    const message = git.formatCommitMessage(
      outcome.summary,
      job.message ?? job.request,
      outcome.reasoning,
    );
    const committed = await git.commitAll(g, message);
    this.events.progress(committed ? "committed" : "no file changes to commit");
    await git.push(g, job.branch.name);
    this.events.setStatus("deploying");
    const result = await deployPreview(this.deployContext(job));
    // The Preview URL is not for people: the session posts the branch link once
    // the deploy is recorded. Only the agent's own words go here.
    this.events.message(outcome.message.trim() || "The change is ready.");
    this.events.setStatus("deployed", result);
  }

  private async verify(): Promise<{ label: string; output: string } | null> {
    for (const step of VERIFICATION) {
      this.events.progress(`running ${step.label}`);
      const result = await run("pnpm", step.args, {
        cwd: this.paths.repo,
        timeoutMs: 20 * 60 * 1000,
        onOutput: (text) => this.events.log(text),
        env: { CI: "true" },
      });
      if (result.code !== 0) {
        return { label: step.label, output: tail(combined(result), 150) };
      }
    }
    return null;
  }

  // --- merge / abandon ----------------------------------------------------

  private async merge(job: BuilderJob): Promise<void> {
    this.events.setStatus("merging");
    const g = await this.clone(job);
    await git.checkout(g, "main");
    await git.fetch(g, job.branch.name);
    if (!(await git.mergeFastForward(g, `origin/${job.branch.name}`))) {
      throw new JobError("main has diverged");
    }
    await git.push(g, "main");
    this.events.progress("main pushed");
    await this.install();
    await deployProduction(this.deployContext(job));
    await this.cleanup(job);
    this.events.message("Merged into main and deployed.");
    this.events.setStatus("merged", { headCommit: await git.revParse(g) });
  }

  private async abandon(job: BuilderJob): Promise<void> {
    this.events.setStatus("abandoning");
    if (!existsSync(`${this.paths.repo}/node_modules`)) {
      // Cleanup needs wrangler from the repository's dependencies.
      if (!existsSync(`${this.paths.repo}/.git`)) await this.clone(job);
      await this.install();
    }
    await this.cleanup(job);
    this.events.message("Branch abandoned.");
    this.events.setStatus("abandoned");
  }

  /** Removes the Preview, the branch D1, the remote branch and the R2 prefix. Each step tolerates failure. */
  private async cleanup(job: BuilderJob): Promise<void> {
    const log = (text: string) => this.events.progress(text);
    const w = wranglerContext(this.deployContext(job));
    log(`deleting preview ${job.branch.previewName}`);
    await wranglerTolerant(
      w,
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
      log,
    );
    log(`deleting D1 ${job.branch.databaseName}`);
    await wranglerTolerant(
      w,
      "wrangler d1 delete",
      ["d1", "delete", job.branch.databaseName, "--skip-confirmation"],
      log,
    );
    log(`deleting remote branch ${job.branch.name}`);
    try {
      await git.deleteRemoteBranch(this.gitContext(job), job.branch.name);
    } catch (error) {
      log(
        `deleting the remote branch failed: ${error instanceof Error ? error.message : String(error)} (ignored)`,
      );
    }
    const bucket = job.cloudflare.productionDatabaseName;
    const prefix = `${job.branch.id}/`;
    log(`deleting R2 objects under ${bucket}/${prefix}`);
    try {
      const deleted = await r2DeletePrefix(job, bucket, prefix);
      log(`deleted ${deleted} R2 objects`);
    } catch (error) {
      log(
        `R2 cleanup failed: ${error instanceof Error ? error.message : String(error)} (ignored)`,
      );
    }
  }
}
