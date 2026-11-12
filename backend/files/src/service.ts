import { eq } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { getDb } from "@backend/db-models/db";
import { file, type FileVisibility } from "@backend/db-models/files";
import { deleteObject, getObject, isOwnKey, putObject, storageKey } from "./storage";

const log = logger("files/service");

type FileRecord = typeof file.$inferSelect;

export interface NewFile {
  /** The folder under the branch's prefix, such as "avatars". */
  folder: string;
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  /** Who may see it: the feature storing the file says, having checked its own permissions. */
  visibility: FileVisibility;
}

export interface StoredFile {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  etag: string;
  body: ReadableStream;
}

/**
 * Writes the bytes under the branch's prefix and records them, uploaded by the
 * principal. Files have no permissions of their own: the feature storing one has
 * checked its own, and says who may see it. Returns the file's id.
 */
export async function storeFile(
  principal: Principal,
  branch: string,
  newFile: NewFile,
): Promise<string> {
  const id = newEntityId("FILE");
  const key = storageKey(branch, newFile.folder, id);
  await putObject(branch, key, newFile.bytes, newFile.mimeType);
  await getDb().insert(file).values({
    id,
    storageKey: key,
    fileName: newFile.fileName,
    mimeType: newFile.mimeType,
    size: newFile.bytes.length,
    userId: principal.userId,
    visibility: newFile.visibility,
  });
  log.info("file stored", {
    fileId: id,
    folder: newFile.folder,
    size: newFile.bytes.length,
    visibility: newFile.visibility,
  });
  return id;
}

/**
 * Forgets a file. Its object goes too when the branch wrote it; an object from
 * another branch (production's, on a branch whose database began as a copy)
 * stays, since that branch still serves it.
 */
export async function deleteFile(branch: string, fileId: string): Promise<void> {
  const row = await loadFile(fileId);
  if (!row) return;
  await getDb().delete(file).where(eq(file.id, fileId));
  if (!isOwnKey(branch, row.storageKey)) {
    log.info("kept another branch's object", { fileId, branch });
    return;
  }
  await deleteObject(branch, row.storageKey);
  log.info("file deleted", { fileId });
}

/**
 * Opens a file for a member: a household file is everyone's, a private one is
 * its uploader's, and an owner sees every file. Throws NOT_FOUND otherwise, as
 * for a file that does not exist.
 */
export async function openFile(
  principal: Principal,
  fileId: string,
): Promise<StoredFile> {
  const row = await loadFile(fileId);
  if (!row || !canSee(principal, row)) throw new DomainError("NOT_FOUND", "No such file");
  const object = await getObject(row.storageKey);
  if (!object) {
    log.error("a recorded file has no object", { fileId });
    throw new DomainError("NOT_FOUND", "No such file");
  }
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: object.size,
    etag: object.httpEtag,
    body: object.body,
  };
}

function canSee(principal: Principal, row: FileRecord): boolean {
  if (row.visibility === "household") return true;
  return row.userId === principal.userId || principal.role === "owner";
}

async function loadFile(fileId: string): Promise<FileRecord | null> {
  const [row] = await getDb().select().from(file).where(eq(file.id, fileId)).limit(1);
  return row ?? null;
}
