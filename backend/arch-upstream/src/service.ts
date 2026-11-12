import { liveBranchOfType } from "@backend/arch-branches/service";
import { branchHead, pullInto } from "@backend/arch-repository/service";
import {
  createSession,
  getSession,
  setSessionStatus,
} from "@backend/arch-sessions/service";
import { DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { renderTemplate } from "@backend/commons/template";
import planTemplate from "../prompts/plan.md?raw";
import { upstreamPermissions } from "./permissions";
import { UPSTREAM, UPSTREAM_BRANCH, upstreamUrl } from "./source";

const log = logger("arch-upstream/service");

/**
 * Pulls the upstream repository into the deployment's `upstream/main` branch
 * and says whether main already has all of it.
 */
export async function checkUpstream(
  principal: Principal,
): Promise<{ upToDate: boolean }> {
  upstreamPermissions.require(principal, "check");
  const pulled = await pullInto(UPSTREAM_BRANCH, {
    url: `${upstreamUrl()}.git`,
    branch: UPSTREAM.branch,
  }).catch((err: unknown) => {
    if (err instanceof DomainError) throw err;
    log.warn("upstream pull failed", { err });
    throw new DomainError(
      "SERVICE_UNAVAILABLE",
      `Could not pull ${UPSTREAM.owner}/${UPSTREAM.repository}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  return { upToDate: pulled.contained };
}

/**
 * Starts a build session that merges the `upstream/main` branch, as the last
 * check left it, into a new branch; one such session is open at a time. From
 * there it is a build session like any other.
 */
export async function mergeUpstream(
  principal: Principal,
): Promise<{ sessionId: string; branchId: string }> {
  upstreamPermissions.require(principal, "merge");
  const open = await liveBranchOfType("upstream-pull");
  if (open) {
    throw new DomainError(
      "CONFLICT",
      `An upstream update is already open on branch ${open.name}; merge or abandon it first`,
    );
  }
  const commit = await branchHead(UPSTREAM_BRANCH);
  if (!commit) {
    throw new DomainError(
      "CONFLICT",
      "Nothing was pulled from upstream yet; check for updates first",
    );
  }
  const session = await createSession(principal);
  try {
    const buildSession = await getSession(principal, session.id);
    await buildSession.proposePlan(principal, {
      request: `Upstream update to ${commit.slice(0, 7)}: merge the updates from ${UPSTREAM.owner}/${UPSTREAM.repository} into this deployment.`,
      name: "upstream update",
      plan: planOf(commit),
    });
    const { branchId } = await buildSession.startBuild({ branchType: "upstream-pull" });
    log.info("upstream update started", {
      sessionId: session.id,
      branchId,
      commit,
      userId: principal.userId,
    });
    return { sessionId: session.id, branchId };
  } catch (err) {
    await setSessionStatus(session.id, "failed");
    throw err;
  }
}

/** The plan the upstream update's chat shows and its builder works from. */
function planOf(commit: string): string {
  return renderTemplate(planTemplate, { commit }).trim();
}
