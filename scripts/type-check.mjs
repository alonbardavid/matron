#!/usr/bin/env node
// `pnpm type-check`: the repository as four programs, one tsc run each, on the
// native TypeScript compiler (the `typescript-native` dependency). The Worker and
// browser groups share packages through the path aliases, so each file is checked
// once per group instead of once per package.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(root, "node_modules/typescript-native/bin/tsc");
const projects = [
  "tsconfig.worker.json",
  "tsconfig.browser.json",
  "apps/builder/tsconfig.json",
  "tests/tsconfig.json",
];

let failed = false;
for (const project of projects) {
  const started = Date.now();
  const result = spawnSync("node", [tsc, "-p", project, "--noEmit"], {
    cwd: root,
    stdio: "inherit",
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status === 0) {
    console.log(`${project}: ok in ${seconds}s`);
  } else {
    failed = true;
    console.log(`${project}: failed in ${seconds}s`);
  }
}
process.exit(failed ? 1 : 0);
