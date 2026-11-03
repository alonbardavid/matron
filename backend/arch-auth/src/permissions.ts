import { createAccessControl } from "better-auth/plugins/access";
import type { Role } from "@backend/commons/principal";

/** The one resource roles are defined over. */
export const statement = {
  branch: ["view", "create", "merge"],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  owner: ac.newRole({ branch: ["view", "create", "merge"] }),
  admin: ac.newRole({ branch: ["view", "create"] }),
  member: ac.newRole({ branch: [] }),
};

export type BranchAction = (typeof statement)["branch"][number];

/** Whether a role may do `action` on a branch; the services ask this, the UI only mirrors it. */
export function canBranch(role: Role, action: BranchAction): boolean {
  return roles[role].authorize({ branch: [action] }).success;
}

/** Roles the admin plugin treats as administrators of users. */
export const ADMIN_ROLES: Role[] = ["owner"];
