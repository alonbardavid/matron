import { definePermissions } from "@backend/commons/permissions";

const ALL = ["view", "create", "update", "share", "remove"] as const;

/** Tasks: every role may keep its own; the object's rule decides whose. */
export const taskPermissions = definePermissions({
  resource: "task",
  actions: ALL,
  grants: { owner: ALL, admin: ALL, member: ALL },
});
