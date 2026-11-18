import { definePermissions } from "@backend/commons/permissions";

/**
 * The household itself: adding and removing its members, and their roles.
 * `manage_owners` is making someone an owner and changing an owner's account.
 */
export const householdPermissions = definePermissions({
  resource: "household",
  actions: ["manage", "manage_owners"],
  grants: { owner: ["manage", "manage_owners"], admin: ["manage"], member: [] },
});

/** The household's members, as everyone may list them to share with. */
export const memberPermissions = definePermissions({
  resource: "member",
  actions: ["view"],
  grants: { owner: ["view"], admin: ["view"], member: ["view"] },
});
