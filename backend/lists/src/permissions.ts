import { definePermissions } from "@backend/commons/permissions";

const ALL = ["view", "create", "update", "share", "remove"] as const;

/** Lists: every role may keep its own; the list's shares decide what others may do. */
export const listPermissions = definePermissions({
  resource: "list",
  actions: ALL,
  grants: { owner: ALL, admin: ALL, member: ALL },
});
