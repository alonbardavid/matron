import { definePermissions } from "@backend/commons/permissions";

const ALL = ["view", "create", "update", "share", "remove"] as const;

/** Calendar events: every role may keep its own; the object's rule decides whose. */
export const eventPermissions = definePermissions({
  resource: "event",
  actions: ALL,
  grants: { owner: ALL, admin: ALL, member: ALL },
});
