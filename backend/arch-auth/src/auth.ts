import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { GenericEndpointContext } from "better-auth";
import { admin } from "better-auth/plugins";
import { DomainError } from "@backend/commons/errors";
import { newEntityId, type Entity } from "@backend/commons/ids";
import type { Principal } from "@backend/commons/principal";
import { authSchema } from "@backend/db-models/arch-auth";
import { getDb } from "@backend/db-models/db";
import { requireOwnerAccess, requireOwnerGrant } from "@backend/household/owners";
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

/** Runs a household rule on better-auth's behalf, answering its refusal as better-auth answers. */
async function asAuthError(rule: () => void | Promise<void>): Promise<void> {
  try {
    await rule();
  } catch (err) {
    if (err instanceof DomainError) throw new APIError(err.code, { message: err.message });
    throw err;
  }
}

/** Who made the request a write belongs to; null for a request with no session, or none at all. */
async function callerOf(ctx: GenericEndpointContext | null): Promise<Principal | null> {
  if (!ctx) return null;
  const session = await getSessionFromCtx(ctx);
  return session ? principalOf(session.user) : null;
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
      // The admin plugin checks what a role may do, not to whom. Every request it
      // takes on one user names them as `userId`: an owner's is the household's to guard.
      before: createAuthMiddleware(async (ctx) => {
        const userId = (ctx.body as { userId?: unknown } | undefined)?.userId;
        if (typeof userId !== "string") return;
        const caller = await callerOf(ctx);
        // Without a session the admin plugin refuses the request itself.
        if (caller) await asAuthError(() => requireOwnerAccess(caller, userId));
      }),
    },
    databaseHooks: {
      user: {
        // Whatever the route, a user written with the owner role is one an owner made.
        create: {
          before: async (data, ctx) => {
            const caller = await callerOf(ctx);
            // The deploy script creates the first owner, with no one signed in.
            if (caller) await asAuthError(() => requireOwnerGrant(caller, data.role));
          },
        },
        update: {
          before: async (data, ctx) => {
            if ("role" in data) {
              const caller = await callerOf(ctx);
              if (caller) await asAuthError(() => requireOwnerGrant(caller, data.role));
            }
            // `image` is the id of an uploaded file, set only by the household's
            // avatar service; a profile update names nothing else as a picture.
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
