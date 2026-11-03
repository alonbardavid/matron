import { env } from "cloudflare:workers";
import type { BuilderObject } from "@backend/arch-builder/builder-object";
import type { BuildSessionObject } from "./session-object";

/** The bindings this package reads; apps/backend/src/env.d.ts is the full declaration. */
export interface SessionsEnv {
  BUILD_SESSIONS: DurableObjectNamespace<BuildSessionObject>;
  BUILDERS: DurableObjectNamespace<BuilderObject>;
  APP_ORIGIN: string;
}

export function sessionsEnv(): SessionsEnv {
  return env as unknown as SessionsEnv;
}
