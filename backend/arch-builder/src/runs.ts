import { branchForSession, type BranchRow } from "@backend/arch-branches/service";
import { DomainError } from "@backend/commons/errors";
import { AI_GATEWAY, deploymentNames } from "@backend/commons/names";
import { logger } from "@backend/commons/logger";
import type {
  AbandonRun,
  BuildRun,
  BuilderBranch,
  BuilderFile,
  BuilderRun,
  BuilderUpstream,
  ContinueRun,
  MergeRun,
} from "./protocol";
import { builderEnv } from "./env";
import { writeToken } from "@backend/arch-repository/service";

const log = logger("arch-builder/runs");

/** A build can run for a long while; the token outlives any single run. */
const TOKEN_TTL_SECONDS = 60 * 60 * 24;

type RunCommon = Omit<BuilderRun, "mode" | "plan" | "message" | "files">;

/**
 * Everything a run carries besides what distinguishes its mode: credentials
 * minted now, and the deployment coordinates.
 * `CLOUDFLARE_ACCOUNT_ID` may be unset locally; the container then fails with
 * a clear message instead of the router refusing to start.
 */
async function runCommon(
  sessionId: string,
  branch: BranchRow,
  request: string,
): Promise<RunCommon> {
  const env = builderEnv();
  const repository = await writeToken(TOKEN_TTL_SECONDS);
  return {
    sessionId,
    branch: toBuilderBranch(branch),
    repository,
    cloudflare: {
      accountId: env.CLOUDFLARE_ACCOUNT_ID ?? "",
      apiToken: env.CLOUDFLARE_API_TOKEN,
      workerName: env.WORKER_NAME,
      productionDatabaseName: deploymentNames(env.WORKER_NAME).database,
      appOrigin: env.APP_ORIGIN,
      aiGateway: AI_GATEWAY,
    },
    request,
    builderImage: env.BUILDER_IMAGE || undefined,
  };
}

function toBuilderBranch(branch: BranchRow): BuilderBranch {
  return {
    id: branch.id,
    name: branch.name,
    previewName: branch.previewName,
    databaseName: branch.databaseName ?? "",
    baseCommit: branch.baseCommit,
  };
}

export async function buildRun(input: {
  sessionId: string;
  branch: BranchRow;
  request: string;
  plan: string;
  files: BuilderFile[];
  upstream?: BuilderUpstream;
}): Promise<BuildRun> {
  return {
    ...(await runCommon(input.sessionId, input.branch, input.request)),
    mode: "build",
    plan: input.plan,
    ...(input.files.length ? { files: input.files } : {}),
    ...(input.upstream ? { upstream: input.upstream } : {}),
  };
}

/** A continuation for a session whose builder is idle; the branch is looked up by session. */
export async function continueRun(input: {
  sessionId: string;
  request: string;
  message: string;
  files: BuilderFile[];
}): Promise<ContinueRun> {
  const branch = await branchForSession(input.sessionId);
  if (!branch)
    throw new DomainError("NOT_FOUND", "This session has no branch to continue");
  return {
    ...(await runCommon(input.sessionId, branch, input.request)),
    mode: "continue",
    message: input.message,
    ...(input.files.length ? { files: input.files } : {}),
  };
}

export async function mergeRun(branch: BranchRow): Promise<MergeRun> {
  return {
    ...(await runCommon(branch.buildSessionId, branch, `Merge ${branch.name}`)),
    mode: "merge",
  };
}

export async function abandonRun(branch: BranchRow): Promise<AbandonRun> {
  return {
    ...(await runCommon(branch.buildSessionId, branch, `Abandon ${branch.name}`)),
    mode: "abandon",
  };
}

/** Hands a merge to the branch's session, which runs it on the builder; the row is already marked merging. */
export async function startMerge(branch: BranchRow): Promise<void> {
  const run = await mergeRun(branch);
  log.info("merge sent", { branchId: branch.id, sessionId: branch.buildSessionId });
  await builderEnv().BUILD_SESSIONS.getByName(branch.buildSessionId).startRun(run);
}

export async function startAbandon(branch: BranchRow): Promise<void> {
  const run = await abandonRun(branch);
  log.info("abandon sent", { branchId: branch.id, sessionId: branch.buildSessionId });
  await builderEnv().BUILD_SESSIONS.getByName(branch.buildSessionId).startRun(run);
}
