import { definePermissions } from "@backend/commons/permissions";

/** Reading a branch's code before merging it, and asking about it. Owners only, as merging is. */
export const reviewPermissions = definePermissions({
  resource: "review",
  actions: ["view"],
  grants: {
    owner: ["view"],
    admin: [],
    member: [],
  },
});
