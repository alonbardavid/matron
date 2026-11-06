import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const backendDir = resolve(import.meta.dirname, "../apps/backend");
const persistTo = "./.wrangler-test";

/** Runs wrangler in apps/backend against the test D1's state. */
export function wrangler(args: string[]): void {
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

export function migrateTestDb(): void {
  wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistTo]);
}

/** Runs `;`-separated statements on the local test D1. */
export function executeSql(statements: string[]): void {
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
