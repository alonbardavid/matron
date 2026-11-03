#!/usr/bin/env node
// Stamps a deploy target onto the config that `vite build` emitted for the
// Worker. Reads the redirect apps/backend/.wrangler/deploy/config.json to find
// that config and writes wrangler.generated.<target>.json beside it.
//
// Env: TARGET (production|preview), WORKER_NAME, DB_NAME, DB_ID, APP_ORIGIN,
// ACCOUNT_ID; optional BUILDER_IMAGE; NO_CONTAINER=1 leaves the builder
// container out of a production config. The bucket and the Artifacts
// namespace are named after the Worker (scripts/lib/names.mjs).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateWranglerConfig } from "./lib/wrangler-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = join(root, "apps/backend");
const redirectFile = join(backendDir, ".wrangler/deploy/config.json");

function fail(message) {
  console.error(`gen-wrangler-config: ${message}`);
  process.exit(1);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`missing required env var ${name}`);
  return value;
}

const target = required("TARGET");
if (target !== "production" && target !== "preview") {
  fail(`TARGET must be "production" or "preview", got "${target}"`);
}
const dbName = required("DB_NAME");

if (!existsSync(redirectFile)) {
  fail(`${relative(process.cwd(), redirectFile)} not found: run pnpm build first`);
}
const redirect = JSON.parse(readFileSync(redirectFile, "utf8"));
if (typeof redirect.configPath !== "string") fail(`${redirectFile} has no configPath`);
const emittedFile = resolve(dirname(redirectFile), redirect.configPath);
if (!existsSync(emittedFile)) {
  fail(
    `emitted config ${relative(process.cwd(), emittedFile)} not found: run pnpm build first`,
  );
}
const outDir = dirname(emittedFile);
const outFile = join(outDir, `wrangler.generated.${target}.json`);

const emitted = JSON.parse(readFileSync(emittedFile, "utf8"));
const config = generateWranglerConfig(emitted, {
  target,
  workerName: required("WORKER_NAME"),
  dbName,
  dbId: required("DB_ID"),
  appOrigin: required("APP_ORIGIN").replace(/\/$/, ""),
  accountId: required("ACCOUNT_ID"),
  builderImage: process.env.BUILDER_IMAGE?.trim() || undefined,
  noContainer: process.env.NO_CONTAINER?.trim() === "1",
  migrationsDir: relative(outDir, join(root, "migrations")),
  dockerfilePath: relative(outDir, join(root, "apps/builder/Dockerfile")),
});

writeFileSync(outFile, JSON.stringify(config, null, 2) + "\n");
const images = config.containers?.[0]?.images ?? {};
const image = Object.values(images)
  .map((entry) => entry.image ?? entry.dockerfile)
  .join(", ");
console.log(
  `Wrote ${relative(process.cwd(), outFile)} (${target}: worker ${config.name}, db ${dbName}` +
    (image ? `, builder image ${image}` : ", no container") +
    ")",
);
