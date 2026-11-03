import { useCallback, useMemo } from "react";
import { canBranch, type BranchAction } from "@backend/arch-auth/permissions";
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
    (action: BranchAction): boolean => (me ? canBranch(me.role, action) : false),
    [me],
  );

  return { me, isLoading: isPending, can, isOwner: me?.role === "owner" };
}
