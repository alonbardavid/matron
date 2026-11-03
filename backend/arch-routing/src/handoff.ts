import { env } from "cloudflare:workers";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { signHandoff } from "./signed-handoff";

const log = logger("arch-routing/handoff");

export interface BranchTarget {
  id: string;
  previewUrl: string | null;
}

/** The application as a fetch handler; a Hono app satisfies this. */
export interface ApplicationHandler {
  fetch(
    request: Request,
    env: unknown,
    executionCtx: unknown,
  ): Response | Promise<Response>;
}

/**
 * The single boundary between router and application: the request goes on
 * with the principal and branch signed in, either to the application in this
 * Worker (main) or, unchanged, to the branch's Preview.
 */
export async function handoff(
  application: ApplicationHandler,
  request: Request,
  principal: Principal | null,
  branch: string,
  target: BranchTarget | null,
  executionCtx: unknown,
): Promise<Response> {
  const headers = await handoffHeaders(request, principal, branch);
  if (!target) {
    return application.fetch(new Request(request, { headers }), env, executionCtx);
  }
  return proxyToPreview(request, headers, target);
}

/**
 * The request's headers as the application receives them: the session cookie
 * gone, since the application must never see it, and the principal and branch
 * signed in.
 */
export async function handoffHeaders(
  request: Request,
  principal: Principal | null,
  branch: string,
): Promise<Headers> {
  const { SIGNING_KEY } = env as unknown as { SIGNING_KEY: string };
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  const signed = await signHandoff(SIGNING_KEY, principal, branch);
  signed.forEach((value, key) => headers.set(key, value));
  return headers;
}

/** The same request, sent to the branch's Preview over its public URL. */
export async function proxyToPreview(
  request: Request,
  headers: Headers,
  target: BranchTarget,
): Promise<Response> {
  if (!target.previewUrl) {
    log.warn("branch has no preview yet", { branchId: target.id });
    return new Response("This branch is still deploying", { status: 503 });
  }
  const url = new URL(request.url);
  const upstream = new URL(target.previewUrl);
  upstream.pathname = url.pathname;
  upstream.search = url.search;
  headers.set("host", upstream.host);
  const response = await fetch(
    new Request(upstream, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    }),
  );
  log.debug("proxied to branch", { branchId: target.id, status: response.status });
  return response;
}
