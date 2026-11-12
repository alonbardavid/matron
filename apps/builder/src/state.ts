import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What one step leaves for the next lives under the work directory, which
 * the harness snapshots and restores with the container: which git auth
 * scheme the remote accepted, and which lockfile was last installed. The
 * coding agent's own session is the harness's to keep.
 */
export type Paths = {
  work: string;
  repo: string;
  state: string;
  gitAuthFile: string;
  installedFile: string;
  claudeConfig: string;
  prompts: string;
  /** Where files attached to the user's messages are written for the agent, outside the checkout. */
  attachments: string;
};

export function paths(work = process.env.MATRON_WORK_DIR ?? "/work"): Paths {
  const state = join(work, "state");
  return {
    work,
    repo: join(work, "repo"),
    state,
    gitAuthFile: join(state, "git-auth"),
    installedFile: join(state, "installed-lockfile"),
    claudeConfig: join(work, "claude"),
    prompts: process.env.MATRON_PROMPTS_DIR ?? "/app/prompts",
    attachments: join(work, "attachments"),
  };
}

export function ensureDirs(p: Paths): void {
  mkdirSync(p.state, { recursive: true });
  mkdirSync(p.claudeConfig, { recursive: true });
}

export function writeGitAuth(p: Paths, scheme: string): void {
  mkdirSync(p.state, { recursive: true });
  writeFileSync(p.gitAuthFile, scheme + "\n");
}

export function readGitAuth(p: Paths): "basic" | "bearer" | undefined {
  if (!existsSync(p.gitAuthFile)) return undefined;
  const scheme = readFileSync(p.gitAuthFile, "utf8").trim();
  return scheme === "basic" || scheme === "bearer" ? scheme : undefined;
}

export function writeInstalled(p: Paths, lockfileHash: string | null): void {
  mkdirSync(p.state, { recursive: true });
  writeFileSync(p.installedFile, (lockfileHash ?? "") + "\n");
}

export function readInstalled(p: Paths): string | null {
  if (!existsSync(p.installedFile)) return null;
  return readFileSync(p.installedFile, "utf8").trim() || null;
}
