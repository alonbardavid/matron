import { env } from "cloudflare:workers";
import { openWithKeys, sealWithKey } from "./crypto";

/**
 * Values kept encrypted at rest (OAuth client secrets, members' tokens),
 * sealed with the Worker's SECRETS_KEY. Each value starts with the version of
 * the key that sealed it (`v1::...`), as the key itself starts with it
 * (`v1-...`). Rotating means a new version: values name the key they need, so
 * an old key can be kept beside the new one until every value is re-sealed.
 */

function secretsKeys(): string[] {
  const { SECRETS_KEY } = env as unknown as { SECRETS_KEY?: string };
  if (!SECRETS_KEY) throw new Error("SECRETS_KEY is not set");
  return [SECRETS_KEY];
}

/** Seals `plaintext` with the current SECRETS_KEY; `purpose` keeps kinds of values apart. */
export async function encryptSecret(purpose: string, plaintext: string): Promise<string> {
  return sealWithKey(secretsKeys()[0]!, purpose, plaintext);
}

/** Opens a value sealed by `encryptSecret`; throws when its key is gone or it was tampered with. */
export async function decryptSecret(purpose: string, sealed: string): Promise<string> {
  return openWithKeys(secretsKeys(), purpose, sealed);
}
