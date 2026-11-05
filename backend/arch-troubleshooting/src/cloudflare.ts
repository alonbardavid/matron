import type { ApiProblem } from "@shared/contract/arch/troubleshooting";
import { troubleshootingEnv } from "./env";

/** The token permissions each kind of call needs, as the dashboard names them. */
export const D1_PERMISSION = "D1 (Edit)";
export const CONTAINERS_PERMISSION = "Containers (Edit)";
export const WORKERS_PERMISSION = "Workers Scripts (Read)";

/** A call Cloudflare refused or could not answer; `problem` says how to read it. */
export class CloudflareError extends Error {
  constructor(readonly problem: ApiProblem) {
    super(problem.message);
    this.name = "CloudflareError";
  }
}

interface Envelope<T> {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
  result_info?: { cursor?: string; count?: number; total_count?: number };
}

/** Error codes that mean the token may not do this, whatever the status says. */
const PERMISSION_CODES = new Set([9109, 10000, 10001]);

/**
 * One call to the account's Cloudflare API with the Worker's token. A refusal
 * becomes a permission problem naming `permission`; anything else an error
 * with Cloudflare's own words.
 */
export async function cloudflare<T>(
  path: string,
  options: { method?: string; body?: unknown; permission: string },
): Promise<{ result: T; cursor: string | null }> {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId } =
    troubleshootingEnv();
  if (!token || !accountId) {
    throw new CloudflareError({
      kind: "missing-token",
      message:
        "This deployment holds no Cloudflare API token: set the CLOUDFLARE_API_TOKEN secret and CLOUDFLARE_ACCOUNT_ID on the Worker.",
      permission: null,
    });
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
    {
      method: options.method ?? "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
  );
  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    // Not JSON: the status tells the story.
  }
  if (!response.ok || !envelope?.success) {
    const first = envelope?.errors?.[0];
    const message = first
      ? `${first.message} (code ${first.code})`
      : `Cloudflare answered ${response.status}`;
    const denied =
      response.status === 401 ||
      response.status === 403 ||
      (first !== undefined && PERMISSION_CODES.has(first.code));
    throw new CloudflareError(
      denied
        ? { kind: "permission", message, permission: options.permission }
        : { kind: "error", message, permission: null },
    );
  }
  return { result: envelope.result, cursor: envelope.result_info?.cursor ?? null };
}

export function problemOf(err: unknown): ApiProblem {
  if (err instanceof CloudflareError) return err.problem;
  return {
    kind: "error",
    message: err instanceof Error ? err.message : String(err),
    permission: null,
  };
}
