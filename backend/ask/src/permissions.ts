import { definePermissions } from "@backend/commons/permissions";

const ALL = ["view", "create", "chat", "rename", "archive"] as const;

/** Conversations with the assistant: everyone has their own. */
export const conversationPermissions = definePermissions({
  resource: "conversation",
  actions: ALL,
  grants: { owner: ALL, admin: ALL, member: ALL },
});

/** The assistant's read-only queries: the household's tables, and the router's. */
export const databasePermissions = definePermissions({
  resource: "database",
  actions: ["read", "read_router"],
  grants: {
    owner: ["read", "read_router"],
    admin: ["read", "read_router"],
    member: ["read"],
  },
});
