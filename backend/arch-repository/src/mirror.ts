import fs from "node:fs";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

/** A pulled branch against the branch it was compared with. */
export interface Pulled {
  /** The pulled branch's head. */
  head: string;
  /** The compared branch already holds that head. */
  contained: boolean;
}

/**
 * Copies a branch of a public git repository into a branch of another
 * repository and compares it with a branch there. Both are fetched into a
 * temporary folder, which in a Worker is memory that lasts for the request;
 * the source is fetched without credentials. The target branch is pushed with
 * the token given and ends at the source's head, whatever it held before.
 */
export async function pullBranch(input: {
  from: { url: string; branch: string };
  to: { url: string; branch: string; token: string };
  compareWith: string;
}): Promise<Pulled> {
  const dir = `/tmp/pull-${crypto.randomUUID()}`;
  try {
    return await pullIn({ fs, dir }, input);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

type Repo = { fs: typeof fs; dir: string };

async function pullIn(
  repo: Repo,
  input: Parameters<typeof pullBranch>[0],
): Promise<Pulled> {
  // A token carries its expiry after the secret; git takes the secret alone.
  const onAuth = () => ({
    username: "x",
    password: input.to.token.split("?expires=")[0],
  });
  await git.init({ ...repo, defaultBranch: input.to.branch });
  await git.addRemote({ ...repo, remote: "source", url: input.from.url });
  await git.addRemote({ ...repo, remote: "target", url: input.to.url });
  const fetch = { ...repo, http, singleBranch: true, tags: false };
  // The compared branch first: what it shares with the source is then not fetched twice.
  const compared = await git.fetch({
    ...fetch,
    remote: "target",
    ref: input.compareWith,
    onAuth,
  });
  const comparedHead = compared.fetchHead;
  if (!comparedHead) throw new Error(`The repository has no ${input.compareWith} branch`);
  const fetched = await git.fetch({ ...fetch, remote: "source", ref: input.from.branch });
  const head = fetched.fetchHead;
  if (!head) throw new Error(`${input.from.url} has no ${input.from.branch} branch`);
  const ref = `refs/heads/${input.to.branch}`;
  await git.writeRef({ ...repo, ref, value: head, force: true });
  const pushed = await git.push({
    ...repo,
    http,
    remote: "target",
    ref: input.to.branch,
    remoteRef: ref,
    force: true,
    onAuth,
  });
  if (!pushed.ok) throw new Error(`The push was refused: ${pushed.error ?? "unknown"}`);

  const contained =
    head === comparedHead ||
    (await git.isDescendent({ ...repo, oid: comparedHead, ancestor: head, depth: -1 }));
  return { head, contained };
}
