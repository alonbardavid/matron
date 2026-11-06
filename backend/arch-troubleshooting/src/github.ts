import { UPSTREAM } from "@backend/commons/names";
import type { UpstreamCommit } from "@shared/contract/arch/troubleshooting";

/** How many upstream commits one check reads; past it the list says there are more. */
export const UPSTREAM_PAGE = 100;

interface CommitRow {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: { name?: string; date?: string } | null;
    committer?: { date?: string } | null;
  };
  author?: { login?: string } | null;
}

interface CompareRow {
  files?: { filename: string }[];
}

/** The upstream branch's newest commits, newest first, from GitHub's public API. */
export async function upstreamCommits(): Promise<UpstreamCommit[]> {
  const rows = await github<CommitRow[]>(
    `/commits?sha=${encodeURIComponent(UPSTREAM.branch)}&per_page=${UPSTREAM_PAGE}`,
  );
  return rows.map((row) => ({
    sha: row.sha,
    title: row.commit.message.split("\n")[0]?.trim() ?? "",
    author: row.commit.author?.name ?? row.author?.login ?? null,
    committedAt: when(row.commit.committer?.date ?? row.commit.author?.date),
    url: row.html_url,
  }));
}

/** The files upstream changed between two of its commits; null when GitHub cannot say. */
export async function upstreamFilesChanged(
  base: string,
  head: string,
): Promise<string[] | null> {
  try {
    const row = await github<CompareRow>(`/compare/${base}...${head}`);
    return (row.files ?? []).map((file) => file.filename);
  } catch {
    return null;
  }
}

export function upstreamUrl(): string {
  return `https://github.com/${UPSTREAM.owner}/${UPSTREAM.repository}`;
}

async function github<T>(path: string): Promise<T> {
  const response = await fetch(
    `https://api.github.com/repos/${UPSTREAM.owner}/${UPSTREAM.repository}${path}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "matron-troubleshooting",
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    let detail = "";
    try {
      detail = ((await response.json()) as { message?: string }).message ?? "";
    } catch {
      // Not JSON: the status tells the story.
    }
    const limited =
      (response.status === 403 || response.status === 429) &&
      response.headers.get("x-ratelimit-remaining") === "0";
    throw new Error(
      limited
        ? "GitHub's rate limit for unauthenticated requests is used up for now; try again within the hour."
        : `GitHub answered ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return (await response.json()) as T;
}

function when(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
