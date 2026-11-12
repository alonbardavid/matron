import { eq } from "drizzle-orm";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { user } from "@backend/db-models/arch-auth";
import { getDb } from "@backend/db-models/db";
import {
  checkPicture,
  PICTURE_OUTPUT_TYPE,
  squarePicture,
} from "@backend/files/pictures";
import { deleteFile, storeFile } from "@backend/files/service";
import { filePath } from "@shared/contract/app/files";
import type { Avatar } from "@shared/contract/app/users";

const log = logger("household/avatar");

/** Pictures live under this folder of the branch's prefix. */
const AVATAR_FOLDER = "avatars";
const AVATAR_SIZE = 256;

export interface AvatarUpload {
  bytes: Uint8Array;
  name: string;
}

/** Where a member's picture is served from: `user.image` holds the file's id. */
export function avatarUrlOf(image: string | null): string | null {
  return image ? filePath(image) : null;
}

/** Replaces the member's own picture with a square JPEG of the upload. */
export async function setAvatar(
  principal: Principal,
  branch: string,
  upload: AvatarUpload,
): Promise<Avatar> {
  checkPicture(upload.bytes);
  const picture = await squarePicture(upload.bytes, AVATAR_SIZE);
  // Everyone sees a member's picture: it stands for them everywhere.
  const fileId = await storeFile(principal, branch, {
    folder: AVATAR_FOLDER,
    bytes: picture,
    fileName: "avatar.jpg",
    mimeType: PICTURE_OUTPUT_TYPE,
    visibility: "household",
  });
  const previous = await swapImage(principal.userId, fileId);
  if (previous) await deleteFile(branch, previous);
  log.info("avatar set", { userId: principal.userId, fileId });
  return { avatarUrl: filePath(fileId) };
}

/** Removes the member's own picture. */
export async function removeAvatar(
  principal: Principal,
  branch: string,
): Promise<Avatar> {
  const previous = await swapImage(principal.userId, null);
  if (previous) await deleteFile(branch, previous);
  log.info("avatar removed", { userId: principal.userId, had: previous !== null });
  return { avatarUrl: null };
}

/** Points the user at `fileId` and returns the file it pointed at before. */
async function swapImage(userId: string, fileId: string | null): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  await db
    .update(user)
    .set({ image: fileId, updatedAt: new Date() })
    .where(eq(user.id, userId));
  return row?.image ?? null;
}
