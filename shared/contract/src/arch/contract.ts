import { branchesContract } from "./branches";
import { sessionsContract } from "./sessions";
import { settingsContract } from "./settings";

/**
 * The router's procedures, all under /api/arch/*. better-auth's own routes
 * under /api/arch/auth/* and the build chat socket are not in it.
 */
export const archContract = {
  branches: branchesContract,
  sessions: sessionsContract,
  settings: settingsContract,
};
export type ArchContract = typeof archContract;
