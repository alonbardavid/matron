import { definePermissions } from "@backend/commons/permissions";

const ALL = ["view", "create", "update", "share", "remove"] as const;

/** Calendar events: every role may keep its own; the object's rule decides whose. */
export const eventPermissions = definePermissions({
  resource: "event",
  actions: ALL,
  grants: { owner: ALL, admin: ALL, member: ALL },
});

const CALENDAR_ACTIONS = ["view", "create", "update", "remove", "connect"] as const;

/**
 * A member's calendars, and connecting their Google Calendar to import from:
 * every role keeps its own, and only its own.
 */
export const calendarPermissions = definePermissions({
  resource: "calendar",
  actions: CALENDAR_ACTIONS,
  grants: { owner: CALENDAR_ACTIONS, admin: CALENDAR_ACTIONS, member: CALENDAR_ACTIONS },
});
