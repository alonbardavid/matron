import { env } from "cloudflare:workers";
import type { BuilderObject } from "@backend/arch-builder/builder-object";
import type { BuildSessionObject } from "@backend/arch-sessions/session-object";
import type { AskSessionObject } from "@backend/ask/ask-object";

/** The bindings this package reads; apps/backend/src/env.d.ts is the full declaration. */
export interface TroubleshootingEnv {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  WORKER_NAME: string;
  BUILDERS: DurableObjectNamespace<BuilderObject>;
  BUILD_SESSIONS: DurableObjectNamespace<BuildSessionObject>;
  ASK_SESSIONS: DurableObjectNamespace<AskSessionObject>;
}

export function troubleshootingEnv(): TroubleshootingEnv {
  return env as unknown as TroubleshootingEnv;
}
