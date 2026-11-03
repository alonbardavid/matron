import { ROLES, type Principal, type Role } from "@backend/commons/principal";
import { getAuth } from "./auth";

/** The signed-in user behind a request's better-auth session cookie, or null. */
export async function resolvePrincipal(request: Request): Promise<Principal | null> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session || session.user.banned) return null;
  return {
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: toRole(session.user.role),
  };
}

function toRole(value: string | null | undefined): Role {
  return (ROLES as readonly string[]).includes(value ?? "") ? (value as Role) : "member";
}
