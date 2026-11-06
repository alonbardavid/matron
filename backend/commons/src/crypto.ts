const encoder = new TextEncoder();

export async function hmacSign(key: string, payload: string): Promise<string> {
  const cryptoKey = await importKey(key);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(payload));
  return base64url(new Uint8Array(signature));
}

export async function hmacVerify(
  key: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSign(key, payload);
  return timingSafeEqual(expected, signature);
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array {
  const padded = text
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** A SECRETS_KEY value: its version, then a dash, then the key material: `v1-<hex>`. */
const SECRETS_KEY_PATTERN = /^(v[0-9]+)-./;
/** Between a sealed value's key version and its body: `v1::<iv>.<ciphertext>`. */
const VERSION_SEPARATOR = "::";

/** The version a SECRETS_KEY value names (`v1` for `v1-...`); throws on a malformed key. */
export function secretsKeyVersion(key: string): string {
  const match = SECRETS_KEY_PATTERN.exec(key);
  if (!match) throw new Error("SECRETS_KEY must start with its version, like v1-");
  return match[1]!;
}

/**
 * Encrypts `plaintext` with AES-GCM under a key derived from the SECRETS_KEY
 * value `key` for `purpose`. The result starts with the key's version
 * (`v1::<iv>.<ciphertext>`, base64url), so every stored value says which key
 * sealed it. A different purpose derives another key, so one value never
 * decrypts as another kind.
 */
export async function sealWithKey(
  key: string,
  purpose: string,
  plaintext: string,
): Promise<string> {
  const version = secretsKeyVersion(key);
  const aes = await deriveAesKey(key, purpose);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aes,
    encoder.encode(plaintext),
  );
  return `${version}${VERSION_SEPARATOR}${base64url(iv)}.${base64url(new Uint8Array(sealed))}`;
}

/** The key version a sealed value names, or null when it is not one. */
export function sealedVersion(sealed: string): string | null {
  const at = sealed.indexOf(VERSION_SEPARATOR);
  return at > 0 ? sealed.slice(0, at) : null;
}

/**
 * Reverses `sealWithKey`, with the key among `keys` whose version the value
 * names; throws when none matches or the value was sealed for another purpose.
 */
export async function openWithKeys(
  keys: readonly string[],
  purpose: string,
  sealed: string,
): Promise<string> {
  const version = sealedVersion(sealed);
  const key = keys.find((k) => secretsKeyVersion(k) === version);
  if (!version || !key) throw new Error(`No SECRETS_KEY for version ${version ?? "?"}`);
  const [iv, body] = sealed.slice(version.length + VERSION_SEPARATOR.length).split(".");
  if (!iv || !body) throw new Error("Not a sealed value");
  const aes = await deriveAesKey(key, purpose);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64url(iv) },
    aes,
    fromBase64url(body),
  );
  return new TextDecoder().decode(plain);
}

async function deriveAesKey(secret: string, purpose: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("matron"),
      info: encoder.encode(purpose),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
