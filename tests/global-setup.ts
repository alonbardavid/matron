import { createUserSql } from "./seed-sql";
import { migrateTestDb, runTestSql } from "./test-db";
import { MEMBER, OWNER } from "./e2e/users";

/** Migrates the local test D1, wipes it and seeds an owner and a member. */
export default async function globalSetup(): Promise<void> {
  migrateTestDb();
  runTestSql([
    "DELETE FROM user_sessions",
    "DELETE FROM user_accounts",
    "DELETE FROM user_verifications",
    "DELETE FROM branches",
    "DELETE FROM build_sessions",
    "DELETE FROM list_item_assignee",
    "DELETE FROM list_item",
    "DELETE FROM list_share",
    "DELETE FROM list",
    "DELETE FROM calendar_event_share",
    "DELETE FROM calendar_event_attendee",
    "DELETE FROM calendar_event_exception",
    "DELETE FROM calendar_event_hidden",
    "DELETE FROM calendar_event",
    "DELETE FROM calendar_share",
    "DELETE FROM calendar",
    "DELETE FROM google_calendar_connection",
    "DELETE FROM google_calendar_watch",
    "DELETE FROM ask_session",
    "DELETE FROM push_subscription",
    "DELETE FROM alarm",
    "DELETE FROM settings",
    "DELETE FROM file",
    "DELETE FROM user",
    await createUserSql(OWNER),
    await createUserSql(MEMBER),
  ]);
}
