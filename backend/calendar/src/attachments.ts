import { and, asc, eq, inArray } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { calendarEventAttachment } from "@backend/db-models/calendar";
import { getDb } from "@backend/db-models/db";
import { deleteFile, storeFile } from "@backend/files/service";
import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_EVENT,
  type Attachment,
} from "@shared/contract/app/calendar";
import { filePath } from "@shared/contract/app/files";

const log = logger("calendar/attachments");

/** Uploads live under this folder of the branch's prefix. */
const ATTACHMENT_FOLDER = "event-attachments";

type AttachmentRow = typeof calendarEventAttachment.$inferSelect;

export interface AttachmentUpload {
  bytes: Uint8Array;
  name: string;
  mimeType: string;
}

/** A link imported from the event's source, such as a Google Drive file. */
export interface ImportedAttachment {
  url: string;
  title: string;
  mimeType: string | null;
}

/** Each event's attachments, oldest first; ids go in chunks under D1's parameter limit. */
export async function attachmentsOfEvents(
  eventIds: string[],
): Promise<Map<string, Attachment[]>> {
  const out = new Map<string, Attachment[]>();
  const unique = [...new Set(eventIds)];
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await getDb()
      .select()
      .from(calendarEventAttachment)
      .where(inArray(calendarEventAttachment.eventId, unique.slice(i, i + 90)))
      .orderBy(asc(calendarEventAttachment.createdAt));
    for (const row of rows) {
      const attachment = toAttachment(row);
      if (attachment) out.set(row.eventId, [...(out.get(row.eventId) ?? []), attachment]);
    }
  }
  return out;
}

/**
 * Stores an upload and attaches it to the event. The caller has checked that
 * the principal may change the event. The file is the household's to read:
 * only members who see the event learn its id.
 */
export async function attachFile(
  principal: Principal,
  branch: string,
  eventId: string,
  upload: AttachmentUpload,
): Promise<void> {
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(upload.mimeType)) {
    throw new DomainError(
      "BAD_REQUEST",
      "Attach pictures, PDFs, text or office documents",
    );
  }
  if (upload.bytes.length === 0)
    throw new DomainError("BAD_REQUEST", "The file is empty");
  if (upload.bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new DomainError(
      "BAD_REQUEST",
      `A file may be at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`,
    );
  }
  await requireRoom(eventId);
  const title = upload.name.trim().slice(0, 200) || "File";
  const fileId = await storeFile(principal, branch, {
    folder: ATTACHMENT_FOLDER,
    bytes: upload.bytes,
    fileName: title,
    mimeType: upload.mimeType,
    visibility: "household",
  });
  await getDb()
    .insert(calendarEventAttachment)
    .values({
      id: newEntityId("CALENDAR_EVENT_ATTACHMENT"),
      eventId,
      kind: "file",
      fileId,
      title,
      mimeType: upload.mimeType,
      source: "matron",
      createdBy: principal.userId,
    });
  log.info("file attached", { eventId, fileId, userId: principal.userId });
}

/** Attaches a link to the event; the caller has checked the principal may change it. */
export async function attachLink(
  principal: Principal,
  eventId: string,
  url: string,
  title: string | undefined,
): Promise<void> {
  if (!safeUrl(url))
    throw new DomainError("BAD_REQUEST", "A web address (http or https)");
  await requireRoom(eventId);
  await getDb()
    .insert(calendarEventAttachment)
    .values({
      id: newEntityId("CALENDAR_EVENT_ATTACHMENT"),
      eventId,
      kind: "link",
      url,
      title: title?.trim() || new URL(url).hostname,
      source: "matron",
      createdBy: principal.userId,
    });
  log.info("link attached", { eventId, userId: principal.userId });
}

/** Removes one attached here, with its file; an imported one changes at its source. */
export async function detach(
  principal: Principal,
  branch: string,
  eventId: string,
  attachmentId: string,
): Promise<void> {
  const row = await getDb()
    .select()
    .from(calendarEventAttachment)
    .where(
      and(
        eq(calendarEventAttachment.id, attachmentId),
        eq(calendarEventAttachment.eventId, eventId),
      ),
    )
    .get();
  if (!row) throw new DomainError("NOT_FOUND", "Attachment not found");
  if (row.source !== "matron") {
    throw new DomainError(
      "BAD_REQUEST",
      "This attachment comes from Google Calendar; change it there",
    );
  }
  await getDb()
    .delete(calendarEventAttachment)
    .where(eq(calendarEventAttachment.id, attachmentId));
  if (row.fileId) await deleteFile(branch, row.fileId);
  log.info("attachment removed", { eventId, attachmentId, userId: principal.userId });
}

/** Removes every attachment of these events, and the files uploaded to them when `branch` is known. */
export async function dropAttachments(
  eventIds: string[],
  branch: string | null,
): Promise<void> {
  if (eventIds.length === 0) return;
  const db = getDb();
  const rows = await db
    .select({ fileId: calendarEventAttachment.fileId })
    .from(calendarEventAttachment)
    .where(inArray(calendarEventAttachment.eventId, eventIds));
  await db
    .delete(calendarEventAttachment)
    .where(inArray(calendarEventAttachment.eventId, eventIds));
  if (!branch) return;
  for (const { fileId } of rows) if (fileId) await deleteFile(branch, fileId);
}

/** The attachments imported to each event, as they came, in order. */
export async function importedAttachmentsOf(
  eventIds: string[],
): Promise<Map<string, ImportedAttachment[]>> {
  const out = new Map<string, ImportedAttachment[]>();
  for (let i = 0; i < eventIds.length; i += 90) {
    const rows = await getDb()
      .select()
      .from(calendarEventAttachment)
      .where(
        and(
          inArray(calendarEventAttachment.eventId, eventIds.slice(i, i + 90)),
          eq(calendarEventAttachment.source, "google"),
        ),
      )
      .orderBy(asc(calendarEventAttachment.createdAt), asc(calendarEventAttachment.id));
    for (const row of rows) {
      out.set(row.eventId, [
        ...(out.get(row.eventId) ?? []),
        { url: row.url ?? "", title: row.title, mimeType: row.mimeType },
      ]);
    }
  }
  return out;
}

/** Replaces an imported event's attachments (as `importedLinks` gives them) from its source; those added here stay. */
export function importedAttachmentWrites(
  eventId: string,
  imported: ImportedAttachment[],
) {
  const db = getDb();
  return [
    db
      .delete(calendarEventAttachment)
      .where(
        and(
          eq(calendarEventAttachment.eventId, eventId),
          eq(calendarEventAttachment.source, "google"),
        ),
      ),
    ...imported.map((item) =>
      db.insert(calendarEventAttachment).values({
        id: newEntityId("CALENDAR_EVENT_ATTACHMENT"),
        eventId,
        kind: "link" as const,
        url: item.url,
        title: item.title,
        mimeType: item.mimeType,
        source: "google" as const,
        createdBy: null,
      }),
    ),
  ];
}

/** Links from a source as they are stored: web addresses only, titled, at most as many as an event holds. */
export function importedLinks(
  links: { url: string; title: string; mimeType: string | null }[],
): ImportedAttachment[] {
  return links
    .filter((item) => safeUrl(item.url))
    .slice(0, MAX_ATTACHMENTS_PER_EVENT)
    .map((item) => ({
      url: item.url,
      title: item.title.trim().slice(0, 200) || new URL(item.url).hostname,
      mimeType: item.mimeType,
    }));
}

async function requireRoom(eventId: string): Promise<void> {
  const rows = await getDb()
    .select({ id: calendarEventAttachment.id })
    .from(calendarEventAttachment)
    .where(eq(calendarEventAttachment.eventId, eventId));
  if (rows.length >= MAX_ATTACHMENTS_PER_EVENT) {
    throw new DomainError(
      "CONFLICT",
      `An event holds at most ${MAX_ATTACHMENTS_PER_EVENT} attachments`,
    );
  }
}

/** Only web addresses: a `javascript:` or `data:` link must never reach an anchor. */
function safeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function toAttachment(row: AttachmentRow): Attachment | null {
  const url = row.kind === "file" && row.fileId ? filePath(row.fileId) : row.url;
  if (!url) return null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    url,
    mimeType: row.mimeType,
    source: row.source,
    createdBy: row.createdBy,
  };
}
