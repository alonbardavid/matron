import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { DomainError } from "@backend/commons/errors";
import { newEntityId, type Entity } from "@backend/commons/ids";
import { authSchema } from "@backend/db-models/arch-auth";
import { getDb } from "@backend/db-models/db";
import { requireUserChange, type UserChange } from "@backend/household/owners";
import { ac, ADMIN_ROLES, roles } from "@backend/access/registry";
import { principalOf } from "./principal";

/** better-auth is mounted here by the router; nothing under it is proxied. */
export const AUTH_BASE_PATH = "/api/arch/auth";

interface AuthEnv {
  BETTER_AUTH_SECRET: string;
  APP_ORIGIN: string;
  /** The household's Google app, set in App settings as secrets of the Worker. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

const AUTH_MODEL_ENTITIES: Record<string, Entity> = {
  user: "USER",
  session: "USER_SESSION",
  account: "USER_ACCOUNT",
  verification: "USER_VERIFICATION",
};

/** The admin routes that act on one user's account, named by `userId` in the body. */
const ACTS_ON_USER = new Set([
  "/admin/set-role",
  "/admin/update-user",
  "/admin/remove-user",
  "/admin/set-user-password",
  "/admin/ban-user",
  "/admin/unban-user",
  "/admin/revoke-user-sessions",
]);

/** A role as the admin plugin takes it: a string, a comma-separated list or an array. */
function rolesIn(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values
    .flatMap((v) => String(v).split(","))
    .map((role) => role.trim())
    .filter(Boolean);
}

/** What an admin route changes about the household's users, or null for any other route. */
function userChangeOf(path: string, body: unknown): UserChange | null {
  const input = (body ?? {}) as {
    role?: unknown;
    userId?: unknown;
    data?: { role?: unknown };
  };
  const userId = typeof input.userId === "string" ? input.userId : undefined;
  if (path === "/admin/create-user") {
    return { roles: [...rolesIn(input.role), ...rolesIn(input.data?.role)] };
  }
  if (!ACTS_ON_USER.has(path)) return null;
  const roles =
    path === "/admin/set-role" ? rolesIn(input.role) : rolesIn(input.data?.role);
  return { roles, userId };
}

function createAuth() {
  const { BETTER_AUTH_SECRET, APP_ORIGIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } =
    env as unknown as AuthEnv;
  const google =
    GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
      ? { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET }
      : null;
  return betterAuth({
    secret: BETTER_AUTH_SECRET,
    baseURL: APP_ORIGIN,
    basePath: AUTH_BASE_PATH,
    database: drizzleAdapter(getDb(), { provider: "sqlite", schema: authSchema }),
    session: { modelName: "user_sessions" },
    account: {
      modelName: "user_accounts",
      // What a provider grants a member is kept sealed with the auth secret.
      encryptOAuthTokens: true,
      // A member links the account they choose, whatever its address.
      accountLinking: { enabled: true, allowDifferentEmails: true },
    },
    socialProviders: {
      // Offered once the household has its Google app. A member links their
      // account to grant access (the feature that asks names the scopes); the
      // household stays closed, so Google never creates a user.
      ...(google && {
        google: {
          clientId: google.clientId,
          clientSecret: google.clientSecret,
          disableSignUp: true,
          // A refresh token on every grant, so access outlives the hour.
          accessType: "offline" as const,
          prompt: "consent" as const,
        },
      }),
    },
    verification: { modelName: "user_verifications" },
    // Sign-up is closed: the deploy script creates the owner, the owner creates
    // the household through the admin plugin.
    emailAndPassword: { enabled: true, disableSignUp: true },
    plugins: [admin({ ac, roles, adminRoles: ADMIN_ROLES, defaultRole: "member" })],
    hooks: {
      // The admin plugin checks what a role may do, not to whom: the household
      // decides who may grant the owner role or change an owner's account.
      before: createAuthMiddleware(async (ctx) => {
        const change = userChangeOf(ctx.path, ctx.body);
        if (!change) return;
        const session = await getSessionFromCtx(ctx);
        // Without a session the admin plugin refuses the request itself.
        if (!session) return;
        try {
          await requireUserChange(principalOf(session.user), change);
        } catch (err) {
          if (err instanceof DomainError) {
            throw new APIError(err.code, { message: err.message });
          }
          throw err;
        }
      }),
    },
    databaseHooks: {
      user: {
        // `image` is the id of an uploaded file, set only by the household's
        // avatar service; a profile update names nothing else as a picture.
        update: {
          before: async (data) => {
            const { image: _image, ...rest } = data;
            return { data: rest };
          },
        },
      },
    },
    advanced: {
      database: {
        generateId: ({ model }) => {
          const entity = AUTH_MODEL_ENTITIES[model];
          if (!entity)
            throw new Error(`No entity id prefix for better-auth model "${model}"`);
          return newEntityId(entity);
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let cached: Auth | null = null;

/** This isolate's instance, built on first use from what the Worker started with. */
export function getAuth(): Auth {
  cached ??= createAuth();
  return cached;
}
