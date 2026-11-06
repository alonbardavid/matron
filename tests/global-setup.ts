import { executeSql, migrateTestDb } from "./d1";
import { createUserSql } from "./seed-sql";
import { MEMBER, OWNER } from "./e2e/users";

/** Migrates the local test D1, wipes it and seeds an owner and a member. */
export default async function globalSetup(): Promise<void> {
  migrateTestDb();
  executeSql([
    "DELETE FROM user_sessions",
    "DELETE FROM user_accounts",
    "DELETE FROM user_verifications",
    "DELETE FROM branches",
    "DELETE FROM build_sessions",
    "DELETE FROM task_share",
    "DELETE FROM task",
    "DELETE FROM calendar_event_share",
    "DELETE FROM calendar_event",
    "DELETE FROM ask_session",
    "DELETE FROM settings",
    "DELETE FROM user",
    await createUserSql(OWNER),
    await createUserSql(MEMBER),
  ]);
}
