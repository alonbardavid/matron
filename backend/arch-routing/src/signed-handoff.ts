import { base64url, fromBase64url, hmacSign, hmacVerify } from "@backend/commons/crypto";
import { ROLES, type Principal } from "@backend/commons/principal";

/**
 * The router's handoff header: the principal (or none, when signed out) and
 * the branch a request is for, signed so the application can trust them.
 */
export const HANDOFF_HEADER = "x-matron-handoff";
export const HANDOFF_SIGNATURE_HEADER = "x-matron-handoff-signature";

const MAX_AGE_MS = 5 * 60_000;

interface HandoffPayload {
  principal: Principal | null;
  branch: string;
  iat: number;
}

export async function signHandoff(
  signingKey: string,
  principal: Principal | null,
  branch: string,
): Promise<Headers> {
  const payload: HandoffPayload = { principal, branch, iat: Date.now() };
  const encoded = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const headers = new Headers();
  headers.set(HANDOFF_HEADER, encoded);
  headers.set(HANDOFF_SIGNATURE_HEADER, await hmacSign(signingKey, encoded));
  return headers;
}

/**
 * The principal and branch a signed request carries, or null when the
 * signature is missing, wrong or stale.
 */
export async function verifyHandoff(
  signingKey: string,
  headers: Headers,
  now = Date.now(),
): Promise<{ principal: Principal | null; branch: string } | null> {
  const encoded = headers.get(HANDOFF_HEADER);
  const signature = headers.get(HANDOFF_SIGNATURE_HEADER);
  if (!encoded || !signature) return null;
  if (!(await hmacVerify(signingKey, encoded, signature))) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64url(encoded)));
  } catch {
    return null;
  }
  if (!isPayload(payload) || Math.abs(now - payload.iat) > MAX_AGE_MS) return null;
  return { principal: payload.principal, branch: payload.branch };
}

function isPayload(value: unknown): value is HandoffPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.branch === "string" &&
    typeof v.iat === "number" &&
    (v.principal === null || isPrincipal(v.principal))
  );
}

function isPrincipal(value: unknown): value is Principal {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    typeof v.name === "string" &&
    typeof v.email === "string" &&
    (ROLES as readonly string[]).includes(String(v.role))
  );
}
