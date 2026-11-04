import { definePermissions } from "@backend/commons/permissions";

/** Branches: seeing them, starting one from a build, merging one into main. */
export const branchPermissions = definePermissions({
  resource: "branch",
  actions: ["view", "create", "merge"],
  grants: {
    owner: ["view", "create", "merge"],
    admin: ["view", "create"],
    member: [],
  },
});

export type BranchAction = (typeof branchPermissions.actions)[number];
