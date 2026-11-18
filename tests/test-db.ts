import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const backendDir = resolve(import.meta.dirname, "../apps/backend");
// The state of the dev server under test (WORKER_PERSIST_TO in playwright.config.ts).
const persistTo = "./.wrangler-test";

function wrangler(args: string[]): void {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: backendDir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `wrangler ${args.slice(0, 3).join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

/** Brings the local test D1 up to the newest migration. */
export function migrateTestDb(): void {
  wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistTo]);
}

/**
 * Runs statements on the local test D1, which the running server reads too:
 * for a state no request of a test can bring about, such as a deployed branch.
 */
export function runTestSql(statements: string[]): void {
  const dir = mkdtempSync(join(tmpdir(), "matron-sql-"));
  const file = join(dir, "statements.sql");
  writeFileSync(file, statements.join(";\n") + ";\n");
  try {
    wrangler([
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      persistTo,
      "--file",
      file,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
