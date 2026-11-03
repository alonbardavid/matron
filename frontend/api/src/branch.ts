/** `?branch=<id>` on the page URL: which branch this tab is on. Absent means main. */
export const BRANCH_PARAM = "branch";
export const MAIN_BRANCH = "main";

/** The branch this tab's URL names, or null on main. */
export function branchParam(): string | null {
  return new URLSearchParams(window.location.search).get(BRANCH_PARAM)?.trim() || null;
}

/** `path` with this tab's branch parameter kept, so a navigation stays on the branch. */
export function withBranch(path: string): string {
  const branch = branchParam();
  if (!branch) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set(BRANCH_PARAM, branch);
  return url.pathname + url.search + url.hash;
}

/** The current page on another branch ("main" drops the parameter). */
export function urlForBranch(branch: string): string {
  const url = new URL(window.location.href);
  if (branch === MAIN_BRANCH) url.searchParams.delete(BRANCH_PARAM);
  else url.searchParams.set(BRANCH_PARAM, branch);
  return url.toString();
}
