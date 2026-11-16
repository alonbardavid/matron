import { Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";

/** A new VAPID key pair: the uncompressed public point and the private scalar, base64url. */
export async function generateVapidKeys() {
  const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const raw = await webcrypto.subtle.exportKey("raw", publicKey);
  const { d } = await webcrypto.subtle.exportKey("jwk", privateKey);
  return { publicKey: Buffer.from(raw).toString("base64url"), privateKey: d };
}
