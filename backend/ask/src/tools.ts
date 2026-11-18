import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  cancelOccurrence,
  createEvent,
  editOccurrence,
  getEvent,
  listOccurrences,
  removeEvent,
  stopRecurrence,
  updateEvent,
} from "@backend/calendar/service";
import type { Principal } from "@backend/commons/principal";
import { listHouseholdUsers } from "@backend/household/users";
import {
  addItem,
  createList,
  getList,
  listLists,
  moveItem,
  removeItem,
  updateItem,
  updateList,
} from "@backend/lists/service";
import {
  calendarEventCreateSchema,
  calendarEventUpdateSchema,
  dayString,
  occurrenceUpdateSchema,
} from "@shared/contract/app/calendar";
import {
  itemCreateSchema,
  itemMoveSchema,
  itemUpdateSchema,
  listCreateSchema,
  listUpdateSchema,
} from "@shared/contract/app/lists";
import { guardReadOnlySql } from "./sql-guard";
import { databasePermissions } from "./permissions";

const MAX_ROWS = 200;

export interface ToolContext {
  principal: Principal;
  /** The user's IANA zone, for events made without one. */
  timeZone: string;
  db: D1Database;
}

/**
 * What the assistant can do, as the user: each tool wraps the service the
 * app itself uses, so the same permissions apply; the SQL tool is for
 * questions the list tools do not answer.
 */
export function householdTools(ctx: ToolContext): ToolSet {
  const { principal } = ctx;
  return {
    list_household_members: tool({
      description: "Who is in the household: ids, names, emails and roles.",
      inputSchema: z.object({}),
      execute: () => listHouseholdUsers(principal),
    }),
    list_lists: tool({
      description:
        "The user's lists (made by them or shared with them), last changed first, each with its first open items, counts, who it is shared with and what the user may do with it (myPermissions: view, edit, share). q keeps lists whose name or items contain it.",
      inputSchema: z.object({ q: z.string().optional() }),
      execute: ({ q }) => listLists(principal, q),
    }),
    get_list: tool({
      description:
        "One list with all its items. Items nest: parentId is the item an item is under (null at the top), position its order among the items beside it.",
      inputSchema: z.object({ id: z.string() }),
      execute: ({ id }) => getList(principal, id),
    }),
    create_list: tool({
      description:
        "Make a list. sharedWith are user ids; permissions gives each of them, besides view, share and/or edit.",
      inputSchema: listCreateSchema,
      execute: (input) => createList(principal, input),
    }),
    update_list: tool({
      description:
        "Rename or recolour a list (needs edit), or change who it is shared with and what each may do (needs share; who may edit needs edit too).",
      inputSchema: listUpdateSchema.extend({ id: z.string() }),
      execute: ({ id, ...changes }) => updateList(principal, id, changes),
    }),
    add_list_item: tool({
      description:
        "Add an item at the end of a list (id is the list's), or under another of its items (parentId). Dates are calendar days, YYYY-MM-DD; assignees are user ids who see the list.",
      inputSchema: itemCreateSchema.extend({ id: z.string() }),
      execute: ({ id, ...item }) => addItem(principal, id, item),
    }),
    update_list_item: tool({
      description:
        "Change an item: its title, description, due date, completion or who it is assigned to.",
      inputSchema: itemUpdateSchema.extend({ id: z.string() }),
      execute: ({ id, ...changes }) => updateItem(principal, id, changes),
    }),
    move_list_item: tool({
      description:
        "Move an item, with the items under it: under parentId (null for the top of the list) at index among the items there (0 first), optionally to another list (listId).",
      inputSchema: itemMoveSchema.extend({ id: z.string() }),
      execute: ({ id, ...move }) => moveItem(principal, id, move),
    }),
    remove_list_item: tool({
      description:
        "Remove an item and the items under it for good. Ask the user first unless they clearly asked for it.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        await removeItem(principal, id);
        return { ok: true };
      },
    }),
    list_events: tool({
      description:
        "What is on the user's calendar between two instants (milliseconds since the epoch), repeating events expanded into occurrences. Each names its calendar and source; source \"google\" is imported from the user's Google Calendar and is read-only here.",
      inputSchema: z.object({ from: z.number(), to: z.number() }),
      execute: ({ from, to }) => listOccurrences(principal, from, to),
    }),
    get_event: tool({
      description:
        "One event in full, including its recurrence and who it is shared with.",
      inputSchema: z.object({ id: z.string() }),
      execute: ({ id }) => getEvent(principal, id),
    }),
    create_event: tool({
      description:
        "Add a calendar event. Times are milliseconds since the epoch in the user's zone; an all-day event spans whole days. permissions lists what each user it is shared with may do besides viewing it: share, edit, both or neither (neither by default). To repeat it, rrule is an iCalendar RRULE value (RFC 5545) without the RRULE: prefix: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY with INTERVAL, BYDAY (MO,WE; in a monthly rule 2TU is the second Tuesday, -1FR the last Friday), BYMONTHDAY (-1 is the last day), and UNTIL=YYYYMMDD (the last day) or COUNT. The start is the first occurrence.",
      inputSchema: calendarEventCreateSchema.omit({ timeZone: true }).extend({
        timeZone: z.string().optional(),
      }),
      execute: (input) =>
        createEvent(principal, { ...input, timeZone: input.timeZone ?? ctx.timeZone }),
    }),
    update_event: tool({
      description:
        "Change an event or its whole series. An imported (Google) event only changes who it is shared with; anything else is changed in Google Calendar.",
      inputSchema: calendarEventUpdateSchema.extend({ id: z.string() }),
      execute: ({ id, ...changes }) => updateEvent(principal, id, changes),
    }),
    edit_occurrence: tool({
      description:
        "Change one occurrence of a repeating event (its title, description or times); the others stay. originalStartAt is the occurrence's originalStartAt from list_events.",
      inputSchema: occurrenceUpdateSchema.extend({
        id: z.string(),
        originalStartAt: z.number(),
      }),
      execute: ({ id, originalStartAt, ...changes }) =>
        editOccurrence(principal, id, originalStartAt, changes),
    }),
    cancel_occurrence: tool({
      description:
        "Remove one occurrence of a repeating event; the others stay. originalStartAt is the occurrence's originalStartAt from list_events.",
      inputSchema: z.object({ id: z.string(), originalStartAt: z.number() }),
      execute: ({ id, originalStartAt }) =>
        cancelOccurrence(principal, id, originalStartAt),
    }),
    stop_recurrence: tool({
      description: "Stop a repeating event from a day on; earlier occurrences stay.",
      inputSchema: z.object({ id: z.string(), from: dayString }),
      execute: ({ id, from }) => stopRecurrence(principal, id, from),
    }),
    remove_event: tool({
      description:
        "Remove an event, and every repetition of it. Ask the user first unless they clearly asked for it.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        await removeEvent(principal, id);
        return { ok: true };
      },
    }),
    query_database: tool({
      description:
        "Run one read-only SQL query (SQLite) against the household's database and get up to 200 rows, for questions the list tools do not answer. The tables and their columns are described in your instructions.",
      inputSchema: z.object({ sql: z.string().min(1).max(4000) }),
      execute: async ({ sql }) => {
        databasePermissions.require(principal, "read");
        const statement = guardReadOnlySql(sql, {
          routerTables: databasePermissions.can(principal.role, "read_router"),
          fileTable: databasePermissions.can(principal.role, "read_files"),
        });
        const result = await ctx.db.prepare(statement).all();
        const rows = result.results ?? [];
        return {
          rows: rows.slice(0, MAX_ROWS),
          truncated: rows.length > MAX_ROWS,
        };
      },
    }),
  };
}
