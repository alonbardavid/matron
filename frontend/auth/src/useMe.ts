import { useCallback, useMemo } from "react";
import { branchPermissions, type BranchAction } from "@backend/arch-branches/permissions";
import { troubleshootingPermissions } from "@backend/arch-troubleshooting/permissions";
import { householdPermissions } from "@backend/household/permissions";
import { useSession } from "@frontend/api/auth-client";

export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function toRole(value: unknown): Role {
  return ROLES.includes(value as Role) ? (value as Role) : "member";
}

export function useMe() {
  const { data, isPending } = useSession();

  const me = useMemo<Me | null>(() => {
    if (!data?.user) return null;
    const { id, name, email, role } = data.user;
    return { id, name, email, role: toRole(role) };
  }, [data]);

  const can = useCallback(
    (action: BranchAction): boolean =>
      me ? branchPermissions.can(me.role, action) : false,
    [me],
  );

  return {
    me,
    isLoading: isPending,
    can,
    isOwner: me?.role === "owner",
    /** Owners and admins: the household's members and settings. */
    canManage: me ? householdPermissions.can(me.role, "manage") : false,
    /** Owners: the deployment's own databases, containers and objects. */
    canTroubleshoot: me ? troubleshootingPermissions.can(me.role, "manage") : false,
  };
}
