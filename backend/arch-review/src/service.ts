import { getBranch, listBranches, type BranchRow } from "@backend/arch-branches/service";
import {
  blobText,
  changedFiles,
  firstParentLog,
  mainHead,
  withRepository,
  type ChangedFile,
} from "@backend/arch-repository/service";
import { getPreparingReview } from "@backend/arch-sessions/service";
import { DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";
import { MAIN_BRANCH, type Principal } from "@backend/commons/principal";
import type { Branch } from "@shared/contract/arch/branches";
import type {
  BranchReview,
  ReviewFile,
  PreparingReview,
  ReviewMessage,
} from "@shared/contract/arch/review";
import { branchCommits } from "./commits";
import { reviewPermissions } from "./permissions";
import { askReviewer } from "./reviewer";

const log = logger("arch-review/service");

/** Main's history looked at to find where the branch was cut. */
const MAIN_LOG_DEPTH = 300;
const BRANCH_LOG_DEPTH = 50;
/** A file larger than this is listed but not shown. */
const MAX_FILE_BYTES = 200_000;
/** What one review sends at most; files past it are listed as too large. */
const MAX_TOTAL_CHARS = 3_000_000;
const READ_CONCURRENCY = 8;
/** Files nobody reads line by line. */
const GENERATED = [/(^|\/)pnpm-lock\.yaml$/];

/** What the review knows of a branch before any file is read. */
export interface BranchState {
  branch: Branch;
  baseCommit: string;
  headCommit: string;
  commits: ReturnType<typeof branchCommits>;
  /** What the builder prepared for the review with the branch's newest deploy. */
  review: PreparingReview;
  changes: ChangedFile[];
}

/** The live branch the principal may review, checked before the repository is opened. */
async function reviewable(
  principal: Principal,
  branchId: string,
): Promise<{ row: BranchRow; branch: Branch }> {
  reviewPermissions.require(principal, "view");
  const row = await getBranch(branchId);
  const head = await mainHead().catch(() => null);
  const branch = (await listBranches(principal, head)).find((b) => b.id === row.id);
  if (!branch) throw new DomainError("NOT_FOUND", "Branch not found");
  return { row, branch };
}

async function loadState(
  repo: ArtifactsRepo,
  { row, branch }: { row: BranchRow; branch: Branch },
): Promise<BranchState> {
  const [branchLog, mainLog, preparingReview] = await Promise.all([
    firstParentLog(repo, row.name, BRANCH_LOG_DEPTH),
    firstParentLog(repo, MAIN_BRANCH, MAIN_LOG_DEPTH),
    getPreparingReview(row.buildSessionId),
  ]);
  const headCommit = branchLog[0]?.hash;
  if (!headCommit) {
    throw new DomainError("CONFLICT", "The branch has no commits yet");
  }
  const commits = branchCommits(branchLog, mainLog, row.baseCommit);
  const review = preparingReview ?? { summary: "", brackets: [] };
  const changes = await changedFiles(repo, row.baseCommit, headCommit);
  return { branch, baseCommit: row.baseCommit, headCommit, commits, review, changes };
}

/** Everything the review screen shows of a live branch: its builder's notes and every changed file's two versions. */
export async function getBranchReview(
  principal: Principal,
  branchId: string,
): Promise<BranchReview> {
  const target = await reviewable(principal, branchId);
  return withRepository(async (repo) => {
    const state = await loadState(repo, target);
    const files = await readFiles(repo, state.changes);
    log.info("branch review read", { branchId, files: files.length });
    return {
      branch: state.branch,
      baseCommit: state.baseCommit,
      headCommit: state.headCommit,
      summary: state.review.summary,
      brackets: state.review.brackets,
      commits: state.commits,
      files,
    };
  });
}

/** The reviewer's next answer to the conversation about the branch; nothing is stored. */
export async function askAboutBranch(
  principal: Principal,
  branchId: string,
  messages: ReviewMessage[],
): Promise<string> {
  const target = await reviewable(principal, branchId);
  const state = await withRepository((repo) => loadState(repo, target));
  log.info("branch review question", { branchId, messages: messages.length });
  return askReviewer(state, messages);
}

async function readFiles(
  repo: ArtifactsRepo,
  changes: ChangedFile[],
): Promise<ReviewFile[]> {
  const files: ReviewFile[] = [];
  let budget = MAX_TOTAL_CHARS;
  for (let i = 0; i < changes.length; i += READ_CONCURRENCY) {
    const batch = changes.slice(i, i + READ_CONCURRENCY);
    const read = await Promise.all(batch.map((change) => readChange(repo, change)));
    for (const file of read) {
      const size = (file.before?.length ?? 0) + (file.after?.length ?? 0);
      if (size > budget) {
        files.push({ ...file, before: null, after: null, omitted: "too-large" });
      } else {
        budget -= size;
        files.push(file);
      }
    }
  }
  return files;
}

async function readChange(repo: ArtifactsRepo, change: ChangedFile): Promise<ReviewFile> {
  const base = { path: change.path, status: change.status };
  if (GENERATED.some((pattern) => pattern.test(change.path))) {
    return { ...base, before: null, after: null, omitted: "generated" };
  }
  const [before, after] = await Promise.all([
    change.before ? blobText(repo, change.before, MAX_FILE_BYTES) : null,
    change.after ? blobText(repo, change.after, MAX_FILE_BYTES) : null,
  ]);
  const omitted = [before, after].find((side) => side && "omitted" in side);
  if (omitted && "omitted" in omitted) {
    return { ...base, before: null, after: null, omitted: omitted.omitted };
  }
  const text = (side: typeof before) => (side && "text" in side ? side.text : null);
  return { ...base, before: text(before), after: text(after), omitted: null };
}
