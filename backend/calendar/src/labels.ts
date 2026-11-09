import { asc, eq, inArray } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { calendarEventLabel, calendarLabel } from "@backend/db-models/calendar";
import { getDb } from "@backend/db-models/db";
import type { Label } from "@shared/contract/app/calendar";
import { labelPermissions } from "./permissions";

const log = logger("calendar/labels");

type LabelRow = typeof calendarLabel.$inferSelect;

/** The household's labels, oldest first. */
export async function listLabels(principal: Principal): Promise<Label[]> {
  labelPermissions.require(principal, "view");
  const rows = await getDb()
    .select()
    .from(calendarLabel)
    .orderBy(asc(calendarLabel.createdAt));
  return rows.map(toLabel);
}

export async function createLabel(
  principal: Principal,
  input: { name: string; color: string },
): Promise<Label> {
  labelPermissions.require(principal, "create");
  const [row] = await getDb()
    .insert(calendarLabel)
    .values({
      id: newEntityId("CALENDAR_LABEL"),
      name: input.name,
      color: input.color,
      creatorId: principal.userId,
    })
    .returning();
  log.info("label created", { labelId: row!.id, userId: principal.userId });
  return toLabel(row!);
}

export async function updateLabel(
  principal: Principal,
  id: string,
  changes: { name?: string; color?: string },
): Promise<Label> {
  labelPermissions.require(principal, "update");
  await manageableLabel(principal, id);
  const [row] = await getDb()
    .update(calendarLabel)
    .set({
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.color !== undefined && { color: changes.color }),
      updatedAt: new Date(),
    })
    .where(eq(calendarLabel.id, id))
    .returning();
  log.info("label updated", { labelId: id, userId: principal.userId });
  return toLabel(row!);
}

/** Removes the label, and with it from every event it was on. */
export async function removeLabel(principal: Principal, id: string): Promise<void> {
  labelPermissions.require(principal, "remove");
  await manageableLabel(principal, id);
  const db = getDb();
  await db.batch([
    db.delete(calendarEventLabel).where(eq(calendarEventLabel.labelId, id)),
    db.delete(calendarLabel).where(eq(calendarLabel.id, id)),
  ]);
  log.info("label removed", { labelId: id, userId: principal.userId });
}

/** Each event's label ids; ids go in chunks under D1's parameter limit. */
export async function labelsOfEvents(eventIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const unique = [...new Set(eventIds)];
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await getDb()
      .select({
        eventId: calendarEventLabel.eventId,
        labelId: calendarEventLabel.labelId,
      })
      .from(calendarEventLabel)
      .where(inArray(calendarEventLabel.eventId, unique.slice(i, i + 90)))
      .orderBy(asc(calendarEventLabel.createdAt));
    for (const row of rows)
      out.set(row.eventId, [...(out.get(row.eventId) ?? []), row.labelId]);
  }
  return out;
}

/** Tags the event with exactly these labels; unknown ids are refused. */
export async function setEventLabels(eventId: string, labelIds: string[]): Promise<void> {
  const wanted = [...new Set(labelIds)];
  const db = getDb();
  if (wanted.length) {
    const known = await db
      .select({ id: calendarLabel.id })
      .from(calendarLabel)
      .where(inArray(calendarLabel.id, wanted));
    if (known.length !== wanted.length) {
      throw new DomainError("BAD_REQUEST", "No such label");
    }
  }
  await db.delete(calendarEventLabel).where(eq(calendarEventLabel.eventId, eventId));
  if (wanted.length) {
    await db.insert(calendarEventLabel).values(
      wanted.map((labelId) => ({
        id: newEntityId("CALENDAR_EVENT_LABEL"),
        eventId,
        labelId,
      })),
    );
  }
}

/** The label, once the caller may change it: whoever made it, or an owner. */
async function manageableLabel(principal: Principal, id: string): Promise<LabelRow> {
  const row = await getDb()
    .select()
    .from(calendarLabel)
    .where(eq(calendarLabel.id, id))
    .get();
  if (!row) throw new DomainError("NOT_FOUND", "Label not found");
  if (row.creatorId !== principal.userId && principal.role !== "owner") {
    throw new DomainError(
      "FORBIDDEN",
      "Only whoever made the label, or an owner, changes it",
    );
  }
  return row;
}

function toLabel(row: LabelRow): Label {
  return { id: row.id, name: row.name, color: row.color, creatorId: row.creatorId };
}
