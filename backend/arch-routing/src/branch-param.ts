import { MAIN_BRANCH } from "@backend/commons/principal";

/** `?branch=<id>` on a URL: which branch the request is for. Absent means main. */
export const BRANCH_PARAM = "branch";

/**
 * The branch a request names. The page URL carries the parameter and the app
 * keeps it on every navigation. Everything a page then requests, API calls,
 * scripts, styles and what they load, carries no parameter but sends the page
 * URL as the referer, so it is read from there. A navigation reads only its
 * own URL: its referer is the page it came from, which may be on another
 * branch. Each tab is on its own branch; nothing is remembered between
 * requests.
 */
export function readBranchParam(request: Request): string {
  const url = new URL(request.url);
  const own = url.searchParams.get(BRANCH_PARAM)?.trim();
  if (own) return own;
  if (isNavigation(request)) return MAIN_BRANCH;
  const referer = request.headers.get("referer");
  if (!referer) return MAIN_BRANCH;
  let from: URL;
  try {
    from = new URL(referer);
  } catch {
    return MAIN_BRANCH;
  }
  if (from.origin !== url.origin) return MAIN_BRANCH;
  return from.searchParams.get(BRANCH_PARAM)?.trim() || MAIN_BRANCH;
}

/** A request for a page: the browser says so, or without that header asks for HTML. */
export function isNavigation(request: Request): boolean {
  const mode = request.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return request.headers.get("accept")?.includes("text/html") ?? false;
}
