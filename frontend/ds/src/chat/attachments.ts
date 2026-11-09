import type { FileUIPart } from "ai";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  ATTACHMENTS_PER_MESSAGE,
} from "@shared/contract/attachments";

export const ATTACHMENT_ACCEPT = ATTACHMENT_TYPES.join(",");

/** The longest edge a picture is shrunk to before it is sent: enough to read a receipt, far less to keep. */
const PICTURE_MAX_EDGE = 1600;
/** A picture smaller than this is sent as it is. */
const PICTURE_KEEP_BYTES = 1024 * 1024;

/** The message's files as the chat sends them, pictures shrunk. Throws with a message to show. */
export async function prepareAttachments(
  files: File[],
  alreadyAttached: number,
): Promise<FileUIPart[]> {
  if (alreadyAttached + files.length > ATTACHMENTS_PER_MESSAGE) {
    throw new Error(`At most ${ATTACHMENTS_PER_MESSAGE} files go with one message`);
  }
  return Promise.all(files.map(prepareAttachment));
}

async function prepareAttachment(file: File): Promise<FileUIPart> {
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
    throw new Error(`${file.name}: pictures, PDFs and text files only`);
  }
  const isPicture = file.type.startsWith("image/") && file.type !== "image/gif";
  const blob = isPicture ? await shrinkPicture(file) : file;
  if (blob.size > ATTACHMENT_MAX_BYTES) {
    throw new Error(
      `${file.name} is larger than ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB`,
    );
  }
  return {
    type: "file",
    mediaType: blob.type,
    filename: file.name,
    url: await dataUrlOf(blob),
  };
}

/** A phone photo at full size is mostly wasted on the model; a JPEG that fits the screen reads the same. */
async function shrinkPicture(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, PICTURE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= PICTURE_KEEP_BYTES) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const shrunk = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  return shrunk ?? file;
}

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(blob);
  });
}

/** A text part left where an attachment was moved out of the conversation: the attachment's type. */
export function attachmentNote(text: string): { name: string } | null {
  const evicted = /^\[evicted (?:([^,\]]+), )?\d+ bytes; preserved at [^\]]+\]$/.exec(
    text,
  );
  return evicted ? { name: evicted[1] ?? "attachment" } : null;
}
