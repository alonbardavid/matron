import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { ac, roles } from "@backend/access/registry";

export const AUTH_BASE_PATH = "/api/arch/auth";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: AUTH_BASE_PATH,
  plugins: [adminClient({ ac, roles })],
});

export const { signIn, signOut, useSession } = authClient;

interface AuthResult<T> {
  data: T | null;
  error: { message?: string; code?: string; statusText?: string; status?: number } | null;
}

/** Turns better-auth's `{ data, error }` into a value or a thrown Error. */
export function unwrapAuth<T>(result: AuthResult<T>): T {
  if (result.error) {
    throw new Error(result.error.message || result.error.statusText || "Request failed");
  }
  return result.data as T;
}
