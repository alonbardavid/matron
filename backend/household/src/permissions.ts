import { definePermissions } from "@backend/commons/permissions";

/** The household itself: its members and its settings. */
export const householdPermissions = definePermissions({
  resource: "household",
  actions: ["manage"],
  grants: { owner: ["manage"], admin: ["manage"], member: [] },
});

/** The household's members, as everyone may list them to share with. */
export const memberPermissions = definePermissions({
  resource: "member",
  actions: ["view"],
  grants: { owner: ["view"], admin: ["view"], member: ["view"] },
});
