import { existsSync, rmSync } from "node:fs";
import {
  combined,
  describeFailure,
  exec,
  tail,
  type ExecOptions,
  type ExecResult,
} from "./exec.js";
import { BuilderError } from "./types.js";

/**
 * How the repository token reaches the remote. The Artifacts protocol says it
 * is a password with any user name ("basic"); "bearer" sends it as an
 * `Authorization: Bearer` header. Clone tries basic first and falls back.
 */
export type GitAuthScheme = "basic" | "bearer";

/**
 * Git with the repository token delivered through environment variables only
 * (GIT_CONFIG_* and a helper that reads MATRON_GIT_TOKEN), so it never appears
 * on a command line or in the clone's config.
 */
export function gitEnv(
  token: string,
  scheme: GitAuthScheme = "basic",
): NodeJS.ProcessEnv {
  const config =
    scheme === "bearer"
      ? { key: "http.extraHeader", value: `Authorization: Bearer ${token}` }
      : {
          key: "credential.helper",
          value: '!f() { echo "username=matron"; echo "password=$MATRON_GIT_TOKEN"; }; f',
        };
  return {
    MATRON_GIT_TOKEN: token,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: config.key,
    GIT_CONFIG_VALUE_0: config.value,
    GIT_TERMINAL_PROMPT: "0",
  };
}

export type GitContext = {
  repo: string;
  token: string;
  scheme?: GitAuthScheme;
  onOutput?: (text: string) => void;
};

async function git(
  ctx: GitContext,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return exec("git", args, {
    cwd: options.cwd ?? ctx.repo,
    env: { ...gitEnv(ctx.token, ctx.scheme ?? "basic"), ...options.env },
    timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
    onOutput: ctx.onOutput,
    input: options.input,
  });
}

async function must(
  ctx: GitContext,
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  const result = await git(ctx, args, options);
  if (result.code !== 0) {
    throw new BuilderError(
      describeFailure(`git ${args[0]}`, result),
      tail(combined(result)),
    );
  }
  return result;
}

/**
 * Clones the remote. When no scheme is fixed on the context, basic auth is
 * tried first and a bearer header second; the scheme that worked is recorded
 * on the context so later pushes reuse it.
 */
export async function clone(
  ctx: GitContext,
  remote: string,
  parentDir: string,
): Promise<void> {
  if (existsSync(ctx.repo)) rmSync(ctx.repo, { recursive: true, force: true });
  const schemes: GitAuthScheme[] = ctx.scheme ? [ctx.scheme] : ["basic", "bearer"];
  let last: ExecResult | undefined;
  for (const scheme of schemes) {
    const result = await git({ ...ctx, scheme }, ["clone", "--quiet", remote, ctx.repo], {
      cwd: parentDir,
    });
    if (result.code === 0) {
      ctx.scheme = scheme;
      await configureIdentity(ctx);
      return;
    }
    last = result;
    if (!isAuthFailure(result)) break;
    if (existsSync(ctx.repo)) rmSync(ctx.repo, { recursive: true, force: true });
  }
  throw new BuilderError(
    describeFailure("git clone", last as ExecResult),
    tail(combined(last as ExecResult)),
  );
}

function isAuthFailure(result: ExecResult): boolean {
  return /authentication failed|401|403|could not read Username|invalid credentials|unauthorized/i.test(
    combined(result),
  );
}

/** `git checkout <branch>` tracking origin/<branch>, after fetching it. */
export async function checkoutRemoteBranch(ctx: GitContext, name: string): Promise<void> {
  await fetch(ctx, name);
  await must(ctx, ["checkout", "--quiet", "-B", name, `origin/${name}`]);
}

export async function configureIdentity(ctx: GitContext): Promise<void> {
  await must(ctx, ["config", "user.name", "Matron Builder"]);
  await must(ctx, ["config", "user.email", "builder@matron.local"]);
}

export async function checkoutNewBranch(
  ctx: GitContext,
  name: string,
  base: string,
): Promise<void> {
  await must(ctx, ["checkout", "--quiet", "-b", name, base]);
}

export async function checkout(ctx: GitContext, ref: string): Promise<void> {
  await must(ctx, ["checkout", "--quiet", ref]);
}

export async function fetch(ctx: GitContext, ...refs: string[]): Promise<void> {
  await must(ctx, ["fetch", "--quiet", "origin", ...refs]);
}

export async function status(ctx: GitContext): Promise<string> {
  return (await must(ctx, ["status", "--short", "--branch"])).stdout;
}

export async function hasChanges(ctx: GitContext): Promise<boolean> {
  return (await must(ctx, ["status", "--porcelain"])).stdout.trim().length > 0;
}

export async function commitAll(ctx: GitContext, message: string): Promise<boolean> {
  await must(ctx, ["add", "-A"]);
  if (!(await hasChanges(ctx))) return false;
  // The message goes through stdin: it is multi-line and user-authored.
  await must(ctx, ["commit", "--quiet", "-F", "-"], { input: message });
  return true;
}

export async function push(ctx: GitContext, branch: string): Promise<void> {
  await must(ctx, ["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`]);
}

export async function deleteRemoteBranch(ctx: GitContext, branch: string): Promise<void> {
  await must(ctx, ["push", "--quiet", "origin", "--delete", branch]);
}

/**
 * Moves the checked-out branch back to `commit`, one of its own earlier
 * commits: the index and the working tree become that commit's, and the
 * commits after it are no longer on the branch.
 */
export async function revertTo(ctx: GitContext, commit: string): Promise<void> {
  const contained = await git(ctx, ["merge-base", "--is-ancestor", commit, "HEAD"]);
  if (contained.code !== 0) {
    throw new BuilderError(
      `The branch does not contain ${commit}, so it cannot go back to it`,
      tail(combined(contained)),
    );
  }
  await must(ctx, ["reset", "--quiet", "--hard", commit]);
}

/**
 * Pushes the checked-out commit as `branch`, which goes back with it. Refused
 * when the remote branch is no longer at `expected`: someone moved it meanwhile.
 */
export async function pushRevert(
  ctx: GitContext,
  branch: string,
  expected: string,
): Promise<void> {
  await must(ctx, [
    "push",
    "--quiet",
    `--force-with-lease=refs/heads/${branch}:${expected}`,
    "origin",
    `HEAD:refs/heads/${branch}`,
  ]);
}

export async function revParse(ctx: GitContext, ref = "HEAD"): Promise<string> {
  return (await must(ctx, ["rev-parse", ref])).stdout.trim();
}

/** The commit of main the current branch is based on, as of the last fetch. */
export async function mergeBaseWithMain(ctx: GitContext): Promise<string> {
  return (await must(ctx, ["merge-base", "origin/main", "HEAD"])).stdout.trim();
}

/**
 * Fetches main so the local `origin/main` ref is current, and reports how many
 * of its commits the checked-out branch lacks. Merging is the agent's job: it
 * only needs the local ref, so it never needs the remote or its token.
 */
export async function fetchMain(ctx: GitContext): Promise<{ behind: number }> {
  await fetch(ctx, "main");
  const behind = (
    await must(ctx, ["rev-list", "--count", "HEAD..origin/main"])
  ).stdout.trim();
  return { behind: Number(behind) || 0 };
}

/** Returns false when a fast-forward is not possible (main has diverged). */
export async function mergeFastForward(ctx: GitContext, ref: string): Promise<boolean> {
  const result = await git(ctx, ["merge", "--ff-only", ref]);
  if (result.code === 0) return true;
  if (
    /not possible to fast-forward|diverged|refusing to merge unrelated/i.test(
      combined(result),
    )
  ) {
    return false;
  }
  throw new BuilderError(describeFailure("git merge", result), tail(combined(result)));
}

/**
 * The commit message: a one-line summary, then the user's request and the
 * agent's reasoning as labelled paragraphs.
 */
export function formatCommitMessage(
  summary: string,
  request: string,
  reasoning: string,
): string {
  const title = oneLine(summary) || "Update from build session";
  const sections = [title];
  sections.push(`Request:\n${indentBlock(request)}`);
  sections.push(`Reasoning:\n${indentBlock(reasoning)}`);
  return sections.join("\n\n") + "\n";
}

function oneLine(text: string): string {
  const first = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return (first ?? "").slice(0, 72).trim();
}

function indentBlock(text: string): string {
  const trimmed = text.trim() || "(none)";
  return trimmed
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}
