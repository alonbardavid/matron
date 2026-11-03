import { branchesContract } from "./branches";
import { sessionsContract } from "./sessions";

/**
 * The router's procedures, all under /api/arch/*. better-auth's own routes
 * under /api/arch/auth/* and the build chat socket are not in it.
 */
export const archContract = {
  branches: branchesContract,
  sessions: sessionsContract,
};
export type ArchContract = typeof archContract;
