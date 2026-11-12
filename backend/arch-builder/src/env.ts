import { env } from "cloudflare:workers";
import type { BuilderObject } from "./builder-object";
import type { BuildSessionLink } from "./session-link";

/** The bindings this package reads; apps/backend/src/env.d.ts is the full declaration. */
export interface BuilderEnv {
  BUILDERS: DurableObjectNamespace<BuilderObject>;
  BUILD_SESSIONS: DurableObjectNamespace<BuildSessionLink>;
  APP_ORIGIN: string;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  WORKER_NAME: string;
  BUILDER_IMAGE?: string;
}

export function builderEnv(): BuilderEnv {
  return env as unknown as BuilderEnv;
}
