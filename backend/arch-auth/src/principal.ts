import { ROLES, type Principal, type Role } from "@backend/commons/principal";

/** A better-auth session's user as the services know them. */
export function principalOf(user: {
  id: string;
  name: string;
  email: string;
  role?: string | null;
}): Principal {
  return { userId: user.id, name: user.name, email: user.email, role: toRole(user.role) };
}

function toRole(value: string | null | undefined): Role {
  return (ROLES as readonly string[]).includes(value ?? "") ? (value as Role) : "member";
}
