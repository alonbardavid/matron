import { DomainError } from "@backend/commons/errors";
import { deploymentNames } from "@backend/commons/names";
import { logger } from "@backend/commons/logger";
import { MAIN_BRANCH } from "@backend/commons/principal";
import { repositoryEnv } from "./env";
import { pullBranch, type Pulled } from "./mirror";

const log = logger("arch-repository/service");

const MAX_LISTED_PATHS = 500;
const MAX_FILE_CHARS = 60_000;
const MAX_SEARCH_FILES = 600;
const MAX_SEARCH_MATCHES = 60;
const MAX_LINE_CHARS = 200;
const MAX_SEARCHED_BLOB_BYTES = 200_000;
const READ_CONCURRENCY = 8;
// Long enough for the fetches and the push.
const PULL_TOKEN_SECONDS = 300;
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  ".git",
  ".wrangler",
  ".turbo",
  "pnpm-lock.yaml",
]);

async function openRepository(): Promise<ArtifactsRepo> {
  const { ARTIFACTS, WORKER_NAME } = repositoryEnv();
  if (!ARTIFACTS) {
    throw new DomainError("SERVICE_UNAVAILABLE", "The code repository is not available");
  }
  const { repository } = deploymentNames(WORKER_NAME);
  try {
    return await ARTIFACTS.get(repository);
  } catch (err) {
    log.error("repository lookup failed", { err, repository });
    throw new DomainError("SERVICE_UNAVAILABLE", "The code repository is not available");
  }
}

// The handle is an RPC stub; it is released explicitly because the project
// targets ES2022, which has no `using` declarations.
function release(repo: ArtifactsRepo): void {
  const disposable = repo as unknown as Record<symbol, (() => void) | undefined>;
  const dispose = (Symbol as unknown as { dispose?: symbol }).dispose;
  if (dispose) disposable[dispose]?.();
}

/** Opens the repository for `fn` and releases the handle after it; share one across related reads. */
export async function withRepository<T>(
  fn: (repo: ArtifactsRepo) => Promise<T>,
): Promise<T> {
  const repo = await openRepository();
  try {
    return await fn(repo);
  } finally {
    release(repo);
  }
}

/** Main's head commit in the code repository (Artifacts). */
export async function mainHead(): Promise<string> {
  const head = await branchHead(MAIN_BRANCH);
  if (!head)
    throw new DomainError(
      "SERVICE_UNAVAILABLE",
      "The code repository has no main branch",
    );
  return head;
}

/** A branch's head commit; null when the repository has no such branch. */
export async function branchHead(branch: string): Promise<string | null> {
  return withRepository(async (repo) => {
    const [head] = await repo.log({ ref: branch, limit: 1 });
    return head?.hash ?? null;
  });
}

/** A short-lived write token for the builder container, with the remote it is for. */
export async function writeToken(
  ttlSeconds: number,
): Promise<{ remote: string; token: string }> {
  return withRepository(async (repo) => {
    const [info, token] = await Promise.all([
      repo.info(),
      repo.createToken("write", ttlSeconds),
    ]);
    log.info("repository write token minted", { expiresAt: token.expiresAt });
    return { remote: info.remote, token: token.plaintext };
  });
}

/** Every file under `directory` on main, repository-relative, up to a cap. */
export async function listFiles(repo: ArtifactsRepo, directory = ""): Promise<string[]> {
  const files = await filesUnder(repo, directory, MAX_LISTED_PATHS);
  if (!files) return [];
  const paths = files.entries.map((file) => file.path);
  if (files.truncated) paths.push("... (more files not listed)");
  return paths;
}

/** A file's text on main, or null when there is no such file. Long files are cut. */
export async function readFile(
  repo: ArtifactsRepo,
  path: string,
): Promise<string | null> {
  const blob = await repo.readFile({ ref: MAIN_BRANCH, path });
  if (!blob) return null;
  const text = await blob.text();
  return text.length > MAX_FILE_CHARS
    ? `${text.slice(0, MAX_FILE_CHARS)}\n... (cut after ${MAX_FILE_CHARS} characters)`
    : text;
}

/**
 * Lines on main containing `query`, case-insensitively, as `path:line: text`.
 * Scans the text files under `directory`, most of a small repository.
 */
export async function searchFiles(
  repo: ArtifactsRepo,
  query: string,
  directory = "",
): Promise<string[]> {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const files = await filesUnder(repo, directory, MAX_SEARCH_FILES);
  if (!files) return [];
  const matches: string[] = [];
  for (let i = 0; i < files.entries.length && matches.length < MAX_SEARCH_MATCHES;) {
    const batch = files.entries.slice(i, i + READ_CONCURRENCY);
    i += READ_CONCURRENCY;
    const texts = await Promise.all(batch.map((file) => textOf(repo, file.hash)));
    batch.forEach((file, index) => {
      const text = texts[index];
      if (!text) return;
      const lines = text.split("\n");
      for (let n = 0; n < lines.length && matches.length < MAX_SEARCH_MATCHES; n++) {
        if (!lines[n]!.toLowerCase().includes(needle)) continue;
        matches.push(
          `${file.path}:${n + 1}: ${lines[n]!.trim().slice(0, MAX_LINE_CHARS)}`,
        );
      }
    });
  }
  if (matches.length >= MAX_SEARCH_MATCHES) matches.push("... (more matches not listed)");
  return matches;
}

interface RepositoryFile {
  path: string;
  hash: string;
}

/** The files under `directory` on main, breadth first; null when it is not a directory. */
async function filesUnder(
  repo: ArtifactsRepo,
  directory: string,
  limit: number,
): Promise<{ entries: RepositoryFile[]; truncated: boolean } | null> {
  const [head] = await repo.log({ ref: MAIN_BRANCH, limit: 1 });
  if (!head) return { entries: [], truncated: false };
  const segments = directory.split("/").filter(Boolean);
  let tree = head.treeHash;
  for (const segment of segments) {
    const entries = (await repo.readTree(tree)) ?? [];
    const next = entries.find((entry) => entry.name === segment && entry.type === "tree");
    if (!next) return null;
    tree = next.hash;
  }
  const prefix = segments.length ? `${segments.join("/")}/` : "";
  const files: RepositoryFile[] = [];
  const queue = [{ hash: tree, prefix }];
  while (queue.length && files.length < limit) {
    const { hash, prefix } = queue.shift()!;
    for (const entry of (await repo.readTree(hash)) ?? []) {
      if (files.length >= limit) return { entries: files, truncated: true };
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const path = `${prefix}${entry.name}`;
      if (entry.type === "tree") queue.push({ hash: entry.hash, prefix: `${path}/` });
      else files.push({ path, hash: entry.hash });
    }
  }
  return { entries: files, truncated: queue.length > 0 && files.length >= limit };
}

/** A blob's text, or null when it is binary or too big to search. */
async function textOf(repo: ArtifactsRepo, hash: string): Promise<string | null> {
  const blob = await repo.readBlob(hash);
  if (!blob || blob.size > MAX_SEARCHED_BLOB_BYTES) return null;
  const text = await blob.text();
  return text.includes("\0") ? null : text;
}

/**
 * Copies a branch of a public git repository into `branch` here, which ends at
 * the source's head whatever it held before, and says whether main holds it.
 */
export async function pullInto(
  branch: string,
  from: { url: string; branch: string },
): Promise<Pulled> {
  const { remote, token } = await writeToken(PULL_TOKEN_SECONDS);
  const pulled = await pullBranch({
    from,
    to: { url: remote, branch, token },
    compareWith: MAIN_BRANCH,
  });
  log.info("branch pulled", { branch, ...pulled });
  return pulled;
}
