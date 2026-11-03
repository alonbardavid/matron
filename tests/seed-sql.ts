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
