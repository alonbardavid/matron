// SQL that creates a credential user the way better-auth expects it: a `user`
// row and a `user_accounts` row whose password better-auth hashed itself.
// scripts/lib/owner-sql.mjs is the JavaScript twin of this file; keep them identical.
import { hashPassword } from "better-auth/crypto";
import { newEntityId } from "../backend/commons/src/ids";

const quote = (value: string) => `'${String(value).replace(/'/g, "''")}'`;

export interface SeedUser {
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  password: string;
}

/** Two INSERT statements separated by ";". */
export async function createUserSql(user: SeedUser): Promise<string> {
  const userId = newEntityId("USER");
  const accountId = newEntityId("USER_ACCOUNT");
  const hash = await hashPassword(user.password);
  return [
    `INSERT INTO user (id, name, email, email_verified, role) VALUES (${quote(userId)}, ${quote(user.name)}, ${quote(user.email)}, 1, ${quote(user.role)})`,
    `INSERT INTO user_accounts (id, account_id, provider_id, user_id, password) VALUES (${quote(accountId)}, ${quote(userId)}, 'credential', ${quote(userId)}, ${quote(hash)})`,
  ].join(";\n");
}

/**
 * A merged branch of `ownerEmail`'s, with its archived build session: created
 * `createdDaysAgo` days ago, merged a day after. Two statements separated by ";".
 */
export function mergedBranchSql(input: {
  ownerEmail: string;
  name: string;
  createdDaysAgo: number;
  /** A revert took it back out, an hour after the merge. */
  reverted?: boolean;
}): string {
  const day = 24 * 60 * 60 * 1000;
  const createdAt = Date.now() - input.createdDaysAgo * day;
  const mergedAt = createdAt + day;
  const revert = input.reverted
    ? `'reverted', ${mergedAt + 60 * 60 * 1000}`
    : "NULL, NULL";
  const sessionId = newEntityId("BUILD_SESSION");
  const branchId = newEntityId("BRANCH");
  const owner = `(SELECT id FROM user WHERE email = ${quote(input.ownerEmail)})`;
  return [
    `INSERT INTO build_sessions (id, user_id, title, status, archived_at, created_at, updated_at) VALUES (${quote(sessionId)}, ${owner}, ${quote(`Add ${input.name}`)}, 'merged', ${mergedAt}, ${createdAt}, ${mergedAt})`,
    `INSERT INTO branches (id, name, preview_name, database_name, build_session_id, user_id, base_commit, head_commit, status, archived_at, revert_status, reverted_at, created_at, updated_at) VALUES (${quote(branchId)}, ${quote(input.name)}, ${quote(input.name)}, ${quote(`matron-${input.name}`)}, ${quote(sessionId)}, ${owner}, '0123456789abcdef0123456789abcdef01234567', 'fedcba9876543210fedcba9876543210fedcba98', 'merged', ${mergedAt}, ${revert}, ${createdAt}, ${mergedAt})`,
  ].join(";\n");
}
