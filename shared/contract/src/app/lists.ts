import { oc } from "@orpc/contract";
import { z } from "zod";
import { dayString, sharePermissionSchema, type SharePermission } from "./calendar";
import { alarmSchema } from "./notifications";

export type { SharePermission };

/**
 * What someone a list is shared with may do: `view` it, as everyone it is
 * shared with may; `edit` it (its items, its name and colour, and who may
 * edit it); `share` it (who it is shared with, and who of them may share it).
 * Whoever made the list may do all three, and alone removes it.
 */
const sharePermissionsSchema = z.array(sharePermissionSchema);

/** The colours a list may take, from the app's palette. */
export const LIST_COLORS = [
  "#b9086e",
  "#3b6fd1",
  "#3fa86b",
  "#d97706",
  "#8e4f76",
  "#1f6b3a",
  "#cc2a82",
  "#6f6169",
] as const;
export const listColorSchema = z.enum(LIST_COLORS);

export const listItemSchema = z.object({
  id: z.string(),
  listId: z.string(),
  /** The item it is under; null at the top of the list. */
  parentId: z.string().nullable(),
  /** Its place among the items beside it, lowest first. */
  position: z.number().int(),
  title: z.string(),
  description: z.string(),
  creatorId: z.string(),
  dueDate: dayString.nullable(),
  completedAt: z.number().nullable(),
  /** User ids it is assigned to; always people who see the list. */
  assignees: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ListItem = z.infer<typeof listItemSchema>;

const listFields = {
  id: z.string(),
  name: z.string(),
  color: z.string(),
  creatorId: z.string(),
  /** User ids the list is shared with, besides its creator. */
  sharedWith: z.array(z.string()),
  /** What each member it is shared with may do, by user id. */
  permissions: z.record(z.string(), sharePermissionsSchema),
  /** What the caller may do with it: all three for its creator. */
  myPermissions: sharePermissionsSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
};

/** A list with all its items, in no particular order: `parentId` and `position` place them. */
export const listSchema = z.object({ ...listFields, items: z.array(listItemSchema) });
export type List = z.infer<typeof listSchema>;

/**
 * An id the browser picks for a list or item it makes, so it can show it, and
 * change it, before the server has it: the prefix, then a UUID.
 */
const clientId = (prefix: "LI" | "LT") =>
  z.string().regex(new RegExp(`^${prefix}_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$`));

const listName = z.string().trim().min(1, "Give the list a name").max(120);
const itemTitle = z.string().trim().min(1, "Give the item a title").max(500);
const description = z.string().trim().max(5000);
const userIds = z.array(z.string()).max(100);

export const listCreateSchema = z.object({
  name: listName,
  color: listColorSchema.optional(),
  sharedWith: userIds.optional(),
  /** What members it is shared with may do, by user id; only view for anyone not named. */
  permissions: z.record(z.string(), sharePermissionsSchema).optional(),
});
export type ListCreate = z.infer<typeof listCreateSchema>;

export const listUpdateSchema = listCreateSchema.partial();
export type ListUpdate = z.infer<typeof listUpdateSchema>;

export const itemCreateSchema = z.object({
  title: itemTitle,
  description: description.optional(),
  dueDate: dayString.nullable().optional(),
  /** The item to put it under, on the same list; at the top when left out. It goes last. */
  parentId: z.string().nullable().optional(),
  assignees: userIds.optional(),
});
export type ItemCreate = z.infer<typeof itemCreateSchema>;

export const itemUpdateSchema = z.object({
  title: itemTitle.optional(),
  description: description.optional(),
  dueDate: dayString.nullable().optional(),
  completed: z.boolean().optional(),
  assignees: userIds.optional(),
});
export type ItemUpdate = z.infer<typeof itemUpdateSchema>;

/** Where an item goes, with the items under it: under `parentId` (null: the top) at `index` among those there. */
export const itemMoveSchema = z.object({
  /** Another list to move it to; its own when left out. */
  listId: z.string().optional(),
  parentId: z.string().nullable(),
  index: z.number().int().min(0),
});
export type ItemMove = z.infer<typeof itemMoveSchema>;

export const listsContract = {
  /**
   * The lists the caller made or was given, each with all its items, last
   * changed first; `q` keeps those whose name or items match.
   */
  list: oc
    .route({ method: "GET", path: "/api/app/lists" })
    .input(z.object({ q: z.string().trim().max(200).optional() }))
    .output(z.array(listSchema)),
  get: oc
    .route({ method: "GET", path: "/api/app/lists/{id}" })
    .input(z.object({ id: z.string() }))
    .output(listSchema),
  /** `id`, when given, is the new list's: picked by the browser, to show it before it is saved. */
  create: oc
    .route({ method: "POST", path: "/api/app/lists" })
    .input(listCreateSchema.extend({ id: clientId("LI").optional() }))
    .output(listSchema),
  /** The name and colour need edit; who it is shared with needs share. */
  update: oc
    .route({ method: "PUT", path: "/api/app/lists/{id}" })
    .input(listUpdateSchema.extend({ id: z.string() }))
    .output(listSchema),
  /** Its creator removes it, with its items. */
  remove: oc
    .route({ method: "DELETE", path: "/api/app/lists/{id}" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ ok: z.literal(true) })),
  /** `itemId`, when given, is the new item's: picked by the browser, like a new list's. */
  addItem: oc
    .route({ method: "POST", path: "/api/app/lists/{id}/items" })
    .input(itemCreateSchema.extend({ id: z.string(), itemId: clientId("LT").optional() }))
    .output(listItemSchema),
  updateItem: oc
    .route({ method: "PUT", path: "/api/app/list-items/{id}" })
    .input(itemUpdateSchema.extend({ id: z.string() }))
    .output(listItemSchema),
  /** Reorders an item, puts it under another, takes it out, or moves it to another list. */
  moveItem: oc
    .route({ method: "PUT", path: "/api/app/list-items/{id}/position" })
    .input(itemMoveSchema.extend({ id: z.string() }))
    .output(listItemSchema),
  /** Removes an item and the items under it. */
  removeItem: oc
    .route({ method: "DELETE", path: "/api/app/list-items/{id}" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ ok: z.literal(true) })),
  /** The caller's own alarm on an item: how long before its due day ends they are reminded. */
  itemAlarm: oc
    .route({ method: "GET", path: "/api/app/list-items/{id}/alarm" })
    .input(z.object({ id: z.string() }))
    .output(alarmSchema),
  /** Sets, changes or (null) removes the caller's own alarm on an item. */
  setItemAlarm: oc
    .route({ method: "PUT", path: "/api/app/list-items/{id}/alarm" })
    .input(alarmSchema.extend({ id: z.string() }))
    .output(alarmSchema),
};
