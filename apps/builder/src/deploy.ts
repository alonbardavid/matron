import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  composePreviewUrl,
  d1Create,
  d1ExecuteFile,
  d1Export,
  d1Find,
  d1Info,
  d1MigrationsApply,
  parsePreviewUrl,
  readOutputFile,
  wrangler,
  wranglerMust,
  workersSubdomain,
  type WranglerContext,
} from "./cloudflare.js";
import * as git from "./git.js";
import { combined, describeFailure, run, tail } from "./run.js";
import type { Paths } from "./state.js";
import { JobError, type BuilderJob, type DeployResult } from "./types.js";

export type DeployContext = {
  job: BuilderJob;
  paths: Paths;
  gitScheme?: git.GitAuthScheme;
  log: (text: string) => void;
  onOutput?: (text: string) => void;
};

/** Where `vite build` says the emitted Worker config is; the generated config is written beside it. */
export const REDIRECT_FILE = ".wrangler/deploy/config.json";

/**
 * The absolute path gen-wrangler-config.mjs writes for a target: next to the
 * emitted config named in the redirect (apps/backend/dist/worker in practice).
 */
export function generatedConfigPath(
  backend: string,
  target: "preview" | "production",
): string {
  const redirectFile = join(backend, REDIRECT_FILE);
  let dir = join(backend, "dist", "worker");
  if (existsSync(redirectFile)) {
    try {
      const redirect = JSON.parse(readFileSync(redirectFile, "utf8")) as {
        configPath?: string;
      };
      if (redirect.configPath)
        dir = dirname(resolve(dirname(redirectFile), redirect.configPath));
    } catch {
      // keep the default
    }
  }
  return join(dir, `wrangler.generated.${target}.json`);
}

/** Builds the repository (`pnpm build` in the clone). */
export async function buildRepo(ctx: DeployContext): Promise<void> {
  const result = await run("pnpm", ["build"], {
    cwd: ctx.paths.repo,
    timeoutMs: 20 * 60 * 1000,
    onOutput: ctx.onOutput,
    env: { CI: "true" },
  });
  if (result.code !== 0)
    throw new JobError(describeFailure("pnpm build", result), tail(combined(result)));
}

/**
 * Runs scripts/gen-wrangler-config.mjs for a target. The script reads the
 * redirect in apps/backend/.wrangler/deploy/config.json and writes
 * apps/backend/dist/worker/wrangler.generated.<target>.json.
 */
export async function generateConfig(
  ctx: DeployContext,
  target: "preview" | "production",
  db: { name: string; id: string },
): Promise<string> {
  const { job } = ctx;
  const env: NodeJS.ProcessEnv = {
    TARGET: target,
    WORKER_NAME: job.cloudflare.workerName,
    DB_NAME: db.name,
    DB_ID: db.id,
    APP_ORIGIN: job.cloudflare.appOrigin,
    ACCOUNT_ID: job.cloudflare.accountId,
  };
  if (job.builderImage) env.BUILDER_IMAGE = job.builderImage;
  const result = await run("node", ["scripts/gen-wrangler-config.mjs"], {
    cwd: ctx.paths.repo,
    env,
    onOutput: ctx.onOutput,
  });
  if (result.code !== 0)
    throw new JobError(
      describeFailure("gen-wrangler-config", result),
      tail(combined(result)),
    );
  const config = generatedConfigPath(backendDir(ctx), target);
  if (!existsSync(config)) {
    throw new JobError(
      `gen-wrangler-config did not write ${config}`,
      tail(combined(result)),
    );
  }
  return config;
}

export function backendDir(ctx: DeployContext): string {
  return join(ctx.paths.repo, "apps", "backend");
}

export function wranglerContext(ctx: DeployContext): WranglerContext {
  return { job: ctx.job, cwd: backendDir(ctx), onOutput: ctx.onOutput };
}

/** Creates the branch database as a clone of production when it does not exist yet. */
export async function ensureBranchDatabase(ctx: DeployContext): Promise<string> {
  const w = wranglerContext(ctx);
  const name = ctx.job.branch.databaseName;
  const existing = await d1Find(w, name);
  if (existing) {
    ctx.log(`D1 ${name} exists (${existing.uuid})`);
    return existing.uuid;
  }
  const dump = join(ctx.paths.work, "dump.sql");
  ctx.log(`exporting ${ctx.job.cloudflare.productionDatabaseName}`);
  await d1Export(w, ctx.job.cloudflare.productionDatabaseName, dump);
  ctx.log(`creating D1 ${name}`);
  await d1Create(w, name);
  try {
    ctx.log(`importing production data into ${name}`);
    await d1ExecuteFile(w, name, dump);
  } finally {
    rmSync(dump, { force: true });
  }
  const created = (await d1Info(w, name)) ?? (await d1Find(w, name));
  if (!created) throw new JobError(`Created D1 ${name} but could not resolve its id.`);
  return created.uuid;
}

export async function deployPreview(ctx: DeployContext): Promise<DeployResult> {
  const { job } = ctx;
  const w = wranglerContext(ctx);

  ctx.log("building");
  await buildRepo(ctx);
  const databaseId = await ensureBranchDatabase(ctx);
  const config = await generateConfig(ctx, "preview", {
    name: job.branch.databaseName,
    id: databaseId,
  });
  ctx.log("applying migrations to the branch database");
  await d1MigrationsApply(w, config);

  const secretsFile = join(
    ctx.paths.work,
    `preview-secrets-${randomBytes(4).toString("hex")}.json`,
  );
  const outputFile = join(ctx.paths.work, "wrangler-output.jsonl");
  // What a Preview must have. It never signs anyone in, so BETTER_AUTH_SECRET
  // is random. No account token goes in: the assistant on the branch reaches
  // its model through the Preview's AI binding.
  writeFileSync(
    secretsFile,
    JSON.stringify({
      SIGNING_KEY: job.signingKey,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    }),
    { mode: 0o600 },
  );
  let previewUrl: string | null;
  try {
    ctx.log(`deploying preview ${job.branch.previewName}`);
    const result = await wrangler(
      w,
      [
        "preview",
        "--config",
        config,
        "--name",
        job.branch.previewName,
        "--worker-name",
        job.cloudflare.workerName,
        "--secrets-file",
        secretsFile,
        "--json",
      ],
      { timeoutMs: 20 * 60 * 1000, env: { WRANGLER_OUTPUT_FILE_PATH: outputFile } },
    );
    const recorded = readOutputFile(outputFile);
    if (result.code !== 0)
      throw new JobError(
        describeFailure("wrangler preview", result),
        tail(combined(result)),
      );
    previewUrl =
      parsePreviewUrl(recorded, job.branch.previewName, job.cloudflare.workerName) ??
      parsePreviewUrl(
        combined(result),
        job.branch.previewName,
        job.cloudflare.workerName,
      );
  } finally {
    rmSync(secretsFile, { force: true });
    rmSync(outputFile, { force: true });
  }
  if (!previewUrl) {
    const subdomain = await workersSubdomain(job);
    if (!subdomain)
      throw new JobError("Preview deployed but its URL could not be determined.");
    previewUrl = composePreviewUrl(
      job.branch.previewName,
      job.cloudflare.workerName,
      subdomain,
    );
  }
  const g = { repo: ctx.paths.repo, token: job.repository.token, scheme: ctx.gitScheme };
  const headCommit = await git.revParse(g);
  const baseCommit = await git.mergeBaseWithMain(g);
  return { previewUrl, databaseId, headCommit, baseCommit };
}

/** Production: migrations on the production D1, then `wrangler deploy`. */
export async function deployProduction(ctx: DeployContext): Promise<void> {
  const w = wranglerContext(ctx);
  const production = ctx.job.cloudflare.productionDatabaseName;
  ctx.log("building");
  await buildRepo(ctx);
  const db = await d1Find(w, production);
  if (!db) throw new JobError(`The production database ${production} was not found.`);
  const config = await generateConfig(ctx, "production", {
    name: production,
    id: db.uuid,
  });
  ctx.log("applying migrations to production");
  await d1MigrationsApply(w, config);
  ctx.log("deploying production");
  await wranglerMust(w, "wrangler deploy", ["deploy", "--config", config], {
    timeoutMs: 20 * 60 * 1000,
  });
}
