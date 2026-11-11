/**
 * The repository Matron is released from. A deployment's own repository began
 * as a push of it; what it has gained since is kept in the deployment's
 * `upstream/main` branch, which a build session can merge like any other change.
 */
export const UPSTREAM = {
  owner: "alonbardavid",
  repository: "matron",
  branch: "main",
} as const;

/** The branch of the deployment's repository that follows the upstream's: `upstream/main`. */
export const UPSTREAM_BRANCH = `upstream/${UPSTREAM.branch}`;

export function upstreamUrl(): string {
  return `https://github.com/${UPSTREAM.owner}/${UPSTREAM.repository}`;
}
