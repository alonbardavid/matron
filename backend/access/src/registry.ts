import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";
import { branchPermissions } from "@backend/arch-branches/permissions";
import { reviewPermissions } from "@backend/arch-review/permissions";
import { troubleshootingPermissions } from "@backend/arch-troubleshooting/permissions";
import { upstreamPermissions } from "@backend/arch-upstream/permissions";
import { conversationPermissions, databasePermissions } from "@backend/ask/permissions";
import { calendarPermissions, eventPermissions } from "@backend/calendar/permissions";
import type { Role } from "@backend/commons/principal";
import { householdPermissions, memberPermissions } from "@backend/household/permissions";
import { pushPermissions } from "@backend/notifications/permissions";
import { taskPermissions } from "@backend/tasks/permissions";
import type { Permissions } from "@backend/commons/permissions";

/**
 * Every feature's permissions, in one list: a new resource adds its
 * `permissions.ts` here. The roles better-auth enforces for its own admin
 * actions are built from the same list, so a role means the same thing
 * everywhere.
 */
const features: Permissions<string, string>[] = [
  branchPermissions,
  householdPermissions,
  memberPermissions,
  taskPermissions,
  eventPermissions,
  calendarPermissions,
  pushPermissions,
  conversationPermissions,
  databasePermissions,
  troubleshootingPermissions,
  reviewPermissions,
  upstreamPermissions,
];

type Statements = Record<string, readonly string[]>;

/** The admin plugin's own resources (users and sessions) and every feature's. */
export const statement: Statements = {
  ...defaultStatements,
  ...Object.fromEntries(features.map((feature) => [feature.resource, feature.actions])),
};

export const ac = createAccessControl(statement);

function roleStatements(role: Role): Statements {
  return {
    ...(role === "member" ? userAc.statements : adminAc.statements),
    ...Object.fromEntries(
      features.map((feature) => [feature.resource, feature.grants[role]]),
    ),
  };
}

export const roles = {
  owner: ac.newRole(roleStatements("owner")),
  admin: ac.newRole(roleStatements("admin")),
  member: ac.newRole(roleStatements("member")),
};

/** Roles the admin plugin treats as administrators of users. */
export const ADMIN_ROLES: Role[] = ["owner", "admin"];
