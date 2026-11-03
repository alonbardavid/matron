import { env } from "cloudflare:workers";

/** The bindings this package reads; apps/backend/src/env.d.ts is the full declaration. */
export interface RepositoryEnv {
  ARTIFACTS?: Artifacts;
  WORKER_NAME: string;
}

export function repositoryEnv(): RepositoryEnv {
  return env as unknown as RepositoryEnv;
}
