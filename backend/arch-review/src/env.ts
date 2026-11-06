import { env } from "cloudflare:workers";

/** The bindings this package reads; apps/backend/src/env.d.ts is the full declaration. */
export interface ReviewEnv {
  APP_ORIGIN: string;
}

export function reviewEnv(): ReviewEnv {
  return env as unknown as ReviewEnv;
}
