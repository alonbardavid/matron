import { env } from "cloudflare:workers";
import { DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";
import {
  MAX_PICTURE_BYTES,
  PICTURE_MIME_TYPES,
  type PictureMimeType,
} from "@shared/contract/app/files";

const log = logger("files/pictures");

/** Every stored picture is a JPEG, whatever came in. */
export const PICTURE_OUTPUT_TYPE = "image/jpeg";

interface PicturesEnv {
  IMAGES?: ImagesBinding;
}

/** The picture's type by its first bytes; the name a browser gave it proves nothing. */
export function checkPicture(bytes: Uint8Array): PictureMimeType {
  if (bytes.length === 0) throw new DomainError("BAD_REQUEST", "The file is empty");
  if (bytes.length > MAX_PICTURE_BYTES) {
    throw new DomainError(
      "BAD_REQUEST",
      `The picture is larger than ${Math.round(MAX_PICTURE_BYTES / 1024 / 1024)} MB`,
    );
  }
  const mimeType = sniffPicture(bytes);
  if (!mimeType) {
    throw new DomainError(
      "BAD_REQUEST",
      `The file is not a picture (${PICTURE_MIME_TYPES.join(", ")})`,
    );
  }
  return mimeType;
}

/** A `size` by `size` JPEG, cropped around the picture's subject. */
export async function squarePicture(
  bytes: Uint8Array,
  size: number,
): Promise<Uint8Array> {
  const images = (env as unknown as PicturesEnv).IMAGES;
  if (!images) throw new DomainError("SERVICE_UNAVAILABLE", "Images are not bound");
  try {
    const output = await images
      .input(new Blob([bytes]).stream())
      .transform({ width: size, height: size, fit: "cover", gravity: "auto" })
      .output({ format: PICTURE_OUTPUT_TYPE, quality: 85, background: "#ffffff" });
    const result = new Uint8Array(await new Response(output.image()).arrayBuffer());
    log.info("picture resized", { from: bytes.length, to: result.length, size });
    return result;
  } catch (err) {
    log.warn("picture could not be read", { err });
    throw new DomainError("BAD_REQUEST", "The picture could not be read");
  }
}

function sniffPicture(bytes: Uint8Array): PictureMimeType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWithText(bytes, "GIF87a") || startsWithText(bytes, "GIF89a"))
    return "image/gif";
  if (startsWithText(bytes, "RIFF") && startsWithText(bytes.subarray(8), "WEBP")) {
    return "image/webp";
  }
  return null;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function startsWithText(bytes: Uint8Array, text: string): boolean {
  return startsWith(
    bytes,
    Array.from(text, (char) => char.charCodeAt(0)),
  );
}
