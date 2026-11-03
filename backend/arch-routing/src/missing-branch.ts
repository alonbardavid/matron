import { isNavigation } from "./branch-param";

/** The static page shown for a branch that does not exist; see apps/backend/static. */
export const MISSING_BRANCH_PAGE = "/branch-not-found.html";

/**
 * The answer when a request names a branch that does not exist or is no
 * longer live: the page, from the Worker's assets, for a navigation; a plain
 * 404 for anything else.
 */
export async function missingBranchResponse(
  request: Request,
  assets: Fetcher,
): Promise<Response> {
  if (!isNavigation(request)) {
    return new Response("Branch not found", { status: 404 });
  }
  const page = await assets.fetch(new URL(MISSING_BRANCH_PAGE, request.url));
  return new Response(page.body, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
