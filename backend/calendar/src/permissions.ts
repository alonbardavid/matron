import { definePermissions } from "@backend/commons/permissions";

const ALL = ["view", "create", "update", "share", "remove"] as const;

/** Calendar events: every role may keep its own; the object's rule decides whose. */
export const eventPermissions = definePermissions({
  resource: "event",
  actions: ALL,
  grants: { owner: ALL, admin: ALL, member: ALL },
});

const CALENDAR_ACTIONS = [
  "view",
  "create",
  "update",
  "share",
  "remove",
  "connect",
] as const;

/**
 * A member's calendars, sharing them read-only, and connecting their Google
 * Calendar to import from: every role keeps its own, and only its own.
 */
export const calendarPermissions = definePermissions({
  resource: "calendar",
  actions: CALENDAR_ACTIONS,
  grants: { owner: CALENDAR_ACTIONS, admin: CALENDAR_ACTIONS, member: CALENDAR_ACTIONS },
});

const LABEL_ACTIONS = ["view", "create", "update", "remove"] as const;

/**
 * The household's event labels: every role sees, uses and makes them; the
 * object's rule (whoever made one, or an owner) decides who changes one.
 */
export const labelPermissions = definePermissions({
  resource: "label",
  actions: LABEL_ACTIONS,
  grants: { owner: LABEL_ACTIONS, admin: LABEL_ACTIONS, member: LABEL_ACTIONS },
});
