// SQL that creates a credential user the way better-auth expects it: a `user`
// row and a `user_accounts` row whose password better-auth hashed itself.
// tests/seed-sql.ts is the TypeScript twin of this file; keep them identical.
import { hashPassword } from "better-auth/crypto";
import { newEntityId } from "../../backend/commons/src/ids.ts";

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

/**
 * @param {{ email: string, name: string, role: "owner" | "admin" | "member", password: string }} user
 * @returns {Promise<string>} Two INSERT statements separated by ";".
 */
export async function createUserSql(user) {
  const userId = newEntityId("USER");
  const accountId = newEntityId("USER_ACCOUNT");
  const hash = await hashPassword(user.password);
  return [
    `INSERT INTO user (id, name, email, email_verified, role) VALUES (${quote(userId)}, ${quote(user.name)}, ${quote(user.email)}, 1, ${quote(user.role)})`,
    `INSERT INTO user_accounts (id, account_id, provider_id, user_id, password) VALUES (${quote(accountId)}, ${quote(userId)}, 'credential', ${quote(userId)}, ${quote(hash)})`,
  ].join(";\n");
}
