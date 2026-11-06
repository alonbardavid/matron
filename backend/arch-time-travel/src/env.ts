import { env } from "cloudflare:workers";

/** The bindings this package reads; apps/backend/src/env.d.ts is the full declaration. */
export interface TimeTravelEnv {
  DB: D1Database;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  WORKER_NAME: string;
}

export function timeTravelEnv(): TimeTravelEnv {
  return env as unknown as TimeTravelEnv;
}
