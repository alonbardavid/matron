import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * `@backend/tasks/service` is `backend/tasks/src/service.ts`. TypeScript learns
 * this from `paths` in tsconfig.base.json; Vite and Vitest from this alias.
 * Both lists are keyed by scope, so a new package needs a `paths` line only.
 */
export const workspaceAlias = [
  {
    find: /^@(backend|frontend|shared)\/([^/]+)\/(.+)$/,
    replacement: `${root}$1/$2/src/$3`,
  },
];
