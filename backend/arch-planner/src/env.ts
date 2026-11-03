import { env } from "cloudflare:workers";

/** The bindings this package reads; apps/backend/src/env.d.ts is the full declaration. */
export interface PlannerEnv {
  APP_ORIGIN: string;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

export function plannerEnv(): PlannerEnv {
  return env as unknown as PlannerEnv;
}
