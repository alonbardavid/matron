import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, timestamp, updatedAt } from "./columns";

export const ROLE_VALUES = ["owner", "admin", "member"] as const;

// Owned by better-auth (with the admin plugin's role and ban columns).
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  role: text("role", { enum: ROLE_VALUES }).default("member").notNull(),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userSessions = sqliteTable(
  "user_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: text("impersonated_by"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("user_sessions_user_id_idx").on(table.userId)],
);

export const userAccounts = sqliteTable(
  "user_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("user_accounts_user_id_idx").on(table.userId)],
);

export const userVerifications = sqliteTable(
  "user_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("user_verifications_identifier_idx").on(table.identifier)],
);

export const authSchema = {
  user,
  user_sessions: userSessions,
  user_accounts: userAccounts,
  user_verifications: userVerifications,
};
