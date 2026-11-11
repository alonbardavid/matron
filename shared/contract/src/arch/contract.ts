import { branchesContract } from "./branches";
import { sessionsContract } from "./sessions";
import { settingsContract } from "./settings";
import { troubleshootingContract } from "./troubleshooting";
import { upstreamContract } from "./upstream";

/**
 * The router's procedures, all under /api/arch/*. better-auth's own routes
 * under /api/arch/auth/* and the build chat socket are not in it.
 */
export const archContract = {
  branches: branchesContract,
  sessions: sessionsContract,
  settings: settingsContract,
  troubleshooting: troubleshootingContract,
  upstream: upstreamContract,
};
export type ArchContract = typeof archContract;
