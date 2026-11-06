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

/**
 * Encrypts `plaintext` with AES-GCM under a key derived from `secret` for
 * `purpose`, for values kept at rest (OAuth secrets and tokens). The result is
 * `v1.<iv>.<ciphertext>`, base64url. A different purpose derives another key,
 * so one ciphertext never decrypts as another kind of value.
 */
export async function encryptText(
  secret: string,
  purpose: string,
  plaintext: string,
): Promise<string> {
  const key = await deriveAesKey(secret, purpose);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(sealed))}`;
}

/** Reverses `encryptText`; throws when the value was not sealed with this secret and purpose. */
export async function decryptText(
  secret: string,
  purpose: string,
  sealed: string,
): Promise<string> {
  const [version, iv, body] = sealed.split(".");
  if (version !== "v1" || !iv || !body) throw new Error("Not an encrypted value");
  const key = await deriveAesKey(secret, purpose);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64url(iv) },
    key,
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
