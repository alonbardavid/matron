import type { ReviewCommit } from "@shared/contract/arch/review";

/** How far back the branch's own commits are looked for. */
const MAX_BRANCH_COMMITS = 50;

export interface ParsedMessage {
  title: string;
  request: string;
  reasoning: string;
}

/** Splits a builder commit message into its title and its request and reasoning paragraphs. */
export function parseCommitMessage(message: string): ParsedMessage {
  const lines = message.split("\n");
  const title = lines[0]?.trim() ?? "";
  const text = lines.slice(1).join("\n");
  return {
    title,
    request: section(text, "Request:\n", "\n\nReasoning:\n"),
    reasoning: section(text, "Reasoning:\n", null),
  };
}

/** The text between `start` and `end` (or the end of the message). */
function section(text: string, start: string, end: string | null): string {
  const from = text.indexOf(start);
  if (from < 0) return "";
  const rest = text.slice(from + start.length);
  const to = end === null ? -1 : rest.indexOf(end);
  const value = (to < 0 ? rest : rest.slice(0, to)).trim();
  return value === "(none)" ? "" : value;
}

/**
 * The branch's own commits, newest first: its first-parent chain from `head`
 * down to the commit it was cut from, which is the first one also on main's
 * first-parent chain (or `baseCommit`). Merges are where it took main in.
 */
export function branchCommits(
  branchLog: ArtifactsCommitMetadata[],
  mainLog: ArtifactsCommitMetadata[],
  baseCommit: string,
): ReviewCommit[] {
  const onMain = new Set(mainLog.map((commit) => commit.hash));
  onMain.add(baseCommit);
  const commits: ReviewCommit[] = [];
  for (const commit of branchLog.slice(0, MAX_BRANCH_COMMITS)) {
    if (onMain.has(commit.hash)) break;
    const parsed = parseCommitMessage(commit.message);
    commits.push({
      hash: commit.hash,
      title: parsed.title,
      request: parsed.request,
      reasoning: parsed.reasoning,
      merge: commit.parents.length > 1,
      committedAt: commit.committedAt * 1000,
    });
  }
  return commits;
}
