import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BuilderJob } from "./types.js";

/**
 * Everything the next turn needs lives under the work directory, which the
 * Worker snapshots and restores. Memory does not survive a restart.
 */
export type Paths = {
  work: string;
  repo: string;
  state: string;
  jobFile: string;
  sessionFile: string;
  gitAuthFile: string;
  eventsFile: string;
  claudeConfig: string;
  prompts: string;
};

export function paths(work = process.env.MATRON_WORK_DIR ?? "/work"): Paths {
  const state = join(work, "state");
  return {
    work,
    repo: join(work, "repo"),
    state,
    jobFile: join(state, "job.json"),
    sessionFile: join(state, "claude-session-id"),
    gitAuthFile: join(state, "git-auth"),
    eventsFile: join(state, "events.jsonl"),
    claudeConfig: join(work, "claude"),
    prompts: process.env.MATRON_PROMPTS_DIR ?? "/app/prompts",
  };
}

export function ensureDirs(p: Paths): void {
  mkdirSync(p.state, { recursive: true });
  mkdirSync(p.claudeConfig, { recursive: true });
}

export function writeJob(p: Paths, job: BuilderJob): void {
  mkdirSync(p.state, { recursive: true });
  writeFileSync(p.jobFile, JSON.stringify(job, null, 2), { mode: 0o600 });
}

export function readJob(p: Paths): BuilderJob | null {
  if (!existsSync(p.jobFile)) return null;
  return JSON.parse(readFileSync(p.jobFile, "utf8")) as BuilderJob;
}

export function writeSessionId(p: Paths, id: string): void {
  mkdirSync(p.state, { recursive: true });
  writeFileSync(p.sessionFile, id + "\n");
}

export function readSessionId(p: Paths): string | null {
  if (!existsSync(p.sessionFile)) return null;
  const id = readFileSync(p.sessionFile, "utf8").trim();
  return id || null;
}

export function clearSessionId(p: Paths): void {
  rmSync(p.sessionFile, { force: true });
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
