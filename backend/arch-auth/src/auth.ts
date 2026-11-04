import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { newEntityId, type Entity } from "@backend/commons/ids";
import { authSchema } from "@backend/db-models/arch-auth";
import { getDb } from "@backend/db-models/db";
import { ac, ADMIN_ROLES, roles } from "@backend/access/registry";

/** better-auth is mounted here by the router; nothing under it is proxied. */
export const AUTH_BASE_PATH = "/api/arch/auth";

interface AuthEnv {
  BETTER_AUTH_SECRET: string;
  APP_ORIGIN: string;
}

const AUTH_MODEL_ENTITIES: Record<string, Entity> = {
  user: "USER",
  session: "USER_SESSION",
  account: "USER_ACCOUNT",
  verification: "USER_VERIFICATION",
};

function createAuth() {
  const { BETTER_AUTH_SECRET, APP_ORIGIN } = env as unknown as AuthEnv;
  return betterAuth({
    secret: BETTER_AUTH_SECRET,
    baseURL: APP_ORIGIN,
    basePath: AUTH_BASE_PATH,
    database: drizzleAdapter(getDb(), { provider: "sqlite", schema: authSchema }),
    session: { modelName: "user_sessions" },
    account: { modelName: "user_accounts" },
    verification: { modelName: "user_verifications" },
    // Sign-up is closed: the deploy script creates the owner, the owner creates
    // the household through the admin plugin.
    emailAndPassword: { enabled: true, disableSignUp: true },
    plugins: [admin({ ac, roles, adminRoles: ADMIN_ROLES, defaultRole: "member" })],
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

export function getAuth(): Auth {
  cached ??= createAuth();
  return cached;
}
