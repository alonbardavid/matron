import { definePermissions } from "@backend/commons/permissions";

const ALL = ["view", "subscribe", "unsubscribe"] as const;

/** Push devices: everyone subscribes their own; the object's rule decides whose. */
export const pushPermissions = definePermissions({
  resource: "push",
  actions: ALL,
  grants: { owner: ALL, admin: ALL, member: ALL },
});
