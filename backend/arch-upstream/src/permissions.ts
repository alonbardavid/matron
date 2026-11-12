import { definePermissions } from "@backend/commons/permissions";

/** Taking in what the upstream repository has gained. Owners only. */
export const upstreamPermissions = definePermissions({
  resource: "upstream",
  actions: ["check", "merge"],
  grants: {
    owner: ["check", "merge"],
    admin: [],
    member: [],
  },
});
