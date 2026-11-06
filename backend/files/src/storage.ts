import { env } from "cloudflare:workers";
import { DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";

const log = logger("files/storage");

/** The bindings this package reads; apps/backend/src/env.d.ts is the full declaration. */
interface FilesEnv {
  FILES: R2Bucket;
}

/**
 * One bucket for production and every branch, each writing under its own
 * prefix: `<branch>/<folder>/<id>`, where the branch is "main" or a branch id.
 * Any branch reads any object, since a branch's database begins as a copy of
 * production's and keeps pointing at production's files. Writing and deleting
 * stay inside the branch's own prefix; cleaning a branch up removes the prefix.
 */
export function storageKey(branch: string, folder: string, id: string): string {
  return `${prefixOf(branch)}${folder}/${id}`;
}

export function prefixOf(branch: string): string {
  return `${branch}/`;
}

/** Whether `key` is under the branch's own prefix, so the branch may change it. */
export function isOwnKey(branch: string, key: string): boolean {
  return key.startsWith(prefixOf(branch));
}

export function filesBucket(): R2Bucket {
  const bucket = (env as unknown as FilesEnv).FILES;
  if (!bucket) throw new DomainError("UNAVAILABLE", "The files bucket is not bound");
  return bucket;
}

export async function putObject(
  branch: string,
  key: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<void> {
  requireOwnKey(branch, key);
  await filesBucket().put(key, bytes, { httpMetadata: { contentType: mimeType } });
}

export async function deleteObject(branch: string, key: string): Promise<void> {
  requireOwnKey(branch, key);
  await filesBucket().delete(key);
}

export async function getObject(key: string): Promise<R2ObjectBody | null> {
  return filesBucket().get(key);
}

function requireOwnKey(branch: string, key: string): void {
  if (isOwnKey(branch, key)) return;
  log.warn("refused to change another branch's object", { branch, key });
  throw new DomainError("FORBIDDEN", "A branch changes only its own files");
}
