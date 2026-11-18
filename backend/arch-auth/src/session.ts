import type { Principal } from "@backend/commons/principal";
import { getAuth } from "./auth";
import { principalOf } from "./principal";

/** The signed-in user behind a request's better-auth session cookie, or null. */
export async function resolvePrincipal(request: Request): Promise<Principal | null> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session || session.user.banned) return null;
  return principalOf(session.user);
}
