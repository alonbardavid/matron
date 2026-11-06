import { branchForSession, type BranchRow } from "@backend/arch-branches/service";
import { DomainError } from "@backend/commons/errors";
import { AI_GATEWAY, deploymentNames } from "@backend/commons/names";
import { logger } from "@backend/commons/logger";
import type {
  AbandonJob,
  BuildJob,
  BuilderBranch,
  BuilderJob,
  ContinueJob,
  MergeJob,
} from "./protocol";
import { builderEnv } from "./env";
import { writeToken } from "@backend/arch-repository/service";

const log = logger("arch-builder/jobs");

/** A build can run for a long while; the token outlives any single job. */
const TOKEN_TTL_SECONDS = 60 * 60 * 24;

type JobCommon = Omit<BuilderJob, "mode" | "plan" | "message">;

/**
 * Everything a job carries besides what distinguishes its mode: credentials
 * minted now, and the deployment coordinates.
 * `CLOUDFLARE_ACCOUNT_ID` may be unset locally; the container then fails with
 * a clear message instead of the router refusing to start.
 */
async function jobCommon(
  sessionId: string,
  branch: BranchRow,
  request: string,
): Promise<JobCommon> {
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
    signingKey: env.SIGNING_KEY,
    secretsKey: env.SECRETS_KEY,
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

export async function buildJob(input: {
  sessionId: string;
  branch: BranchRow;
  request: string;
  plan: string;
}): Promise<BuildJob> {
  return {
    ...(await jobCommon(input.sessionId, input.branch, input.request)),
    mode: "build",
    plan: input.plan,
  };
}

/** A continuation for a session whose container stopped; the branch is looked up by session. */
export async function continueJob(input: {
  sessionId: string;
  request: string;
  message: string;
}): Promise<ContinueJob> {
  const branch = await branchForSession(input.sessionId);
  if (!branch)
    throw new DomainError("NOT_FOUND", "This session has no branch to continue");
  return {
    ...(await jobCommon(input.sessionId, branch, input.request)),
    mode: "continue",
    message: input.message,
  };
}

export async function mergeJob(branch: BranchRow): Promise<MergeJob> {
  return {
    ...(await jobCommon(branch.buildSessionId, branch, `Merge ${branch.name}`)),
    mode: "merge",
  };
}

export async function abandonJob(branch: BranchRow): Promise<AbandonJob> {
  return {
    ...(await jobCommon(branch.buildSessionId, branch, `Abandon ${branch.name}`)),
    mode: "abandon",
  };
}

/** Hands a merge to the branch's builder; the row is already marked merging. */
export async function startMerge(branch: BranchRow): Promise<void> {
  const job = await mergeJob(branch);
  log.info("merge job sent", { branchId: branch.id, sessionId: branch.buildSessionId });
  await builderEnv().BUILDERS.getByName(branch.buildSessionId).startMerge(job);
}

export async function startAbandon(branch: BranchRow): Promise<void> {
  const job = await abandonJob(branch);
  log.info("abandon job sent", { branchId: branch.id, sessionId: branch.buildSessionId });
  await builderEnv().BUILDERS.getByName(branch.buildSessionId).startAbandon(job);
}
