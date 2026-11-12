import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createUserSql } from "./seed-sql";
import { MEMBER, OWNER } from "./e2e/users";

const backendDir = resolve(import.meta.dirname, "../apps/backend");
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

/** Migrates the local test D1, wipes it and seeds an owner and a member. */
export default async function globalSetup(): Promise<void> {
  wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistTo]);
  const sql = [
    "DELETE FROM user_sessions",
    "DELETE FROM user_accounts",
    "DELETE FROM user_verifications",
    "DELETE FROM branches",
    "DELETE FROM build_sessions",
    "DELETE FROM task_share",
    "DELETE FROM task",
    "DELETE FROM calendar_event_share",
    "DELETE FROM calendar_event_exception",
    "DELETE FROM calendar_event_label",
    "DELETE FROM calendar_event_hidden",
    "DELETE FROM calendar_label",
    "DELETE FROM calendar_event",
    "DELETE FROM calendar_share",
    "DELETE FROM calendar",
    "DELETE FROM google_calendar_connection",
    "DELETE FROM google_calendar_watch",
    "DELETE FROM ask_session",
    "DELETE FROM settings",
    "DELETE FROM file",
    "DELETE FROM user",
    await createUserSql(OWNER),
    await createUserSql(MEMBER),
  ].join(";\n");
  const dir = mkdtempSync(join(tmpdir(), "matron-seed-"));
  const file = join(dir, "seed.sql");
  writeFileSync(file, sql + ";\n");
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
