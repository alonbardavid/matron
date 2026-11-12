import { logger } from "@backend/commons/logger";
import { getAuth } from "./auth";

/**
 * What the application may use of the router's auth: the accounts members
 * linked at a provider (Google, or any provider offered later) and the access
 * they granted. Sign-in, sessions and the provider's own settings stay behind
 * this file; application code imports nothing else from this package.
 */

const log = logger("arch-auth/app-interface");

/** An account a member linked at a provider. */
export interface LinkedAccount {
  /** The account's id at the provider. */
  providerAccountId: string;
  /** What the member allowed. */
  scopes: string[];
}

/** The member has no account linked at the provider. */
export class AccountNotLinkedError extends Error {
  constructor(providerId: string) {
    super(`No ${providerId} account is linked`);
    this.name = "AccountNotLinkedError";
  }
}

/** The provider no longer honours the grant, or is not offered any more: the member links again. */
export class AccountGrantError extends Error {
  constructor(providerId: string) {
    super(`The ${providerId} account's access could not be renewed`);
    this.name = "AccountGrantError";
  }
}

/** Whether members can link an account at the provider: the household has set it up. */
export async function providerAvailable(providerId: string): Promise<boolean> {
  const context = await getAuth().$context;
  return context.socialProviders.some((provider) => provider.id === providerId);
}

/** The account the member linked at the provider, or null. With several, the one linked last. */
export async function linkedAccountOf(
  userId: string,
  providerId: string,
): Promise<LinkedAccount | null> {
  const account = await accountRow(userId, providerId);
  return account
    ? {
        providerAccountId: account.accountId,
        scopes: (account.scope ?? "").split(/[\s,]+/).filter(Boolean),
      }
    : null;
}

/**
 * An access token for the member's account at the provider, valid now: the
 * stored one, renewed first when it is about to expire. `renew` asks the
 * provider for a new one whatever the stored one says, for when the provider
 * just refused it.
 */
export async function accessTokenOf(
  userId: string,
  providerId: string,
  options: { renew?: boolean } = {},
): Promise<string> {
  const auth = getAuth();
  const account = await accountRow(userId, providerId);
  if (!account) throw new AccountNotLinkedError(providerId);
  const body = { accountId: account.id, userId };
  try {
    const tokens = options.renew
      ? await auth.api.refreshToken({ body })
      : await auth.api.getAccessToken({ body });
    if (!tokens.accessToken) throw new Error("no access token");
    return tokens.accessToken;
  } catch (err) {
    log.warn("access token unavailable", { err, userId, providerId });
    throw new AccountGrantError(providerId);
  }
}

/** Forgets the member's accounts at the provider, and with them what was granted. */
export async function unlinkAccountsOf(
  userId: string,
  providerId: string,
): Promise<void> {
  const context = await getAuth().$context;
  const accounts = await context.internalAdapter.findAccounts(userId);
  for (const account of accounts) {
    if (account.providerId === providerId)
      await context.internalAdapter.deleteAccount(account.id);
  }
  log.info("provider accounts unlinked", { userId, providerId });
}

async function accountRow(userId: string, providerId: string) {
  const context = await getAuth().$context;
  const accounts = await context.internalAdapter.findAccounts(userId);
  return (
    accounts
      .filter((account) => account.providerId === providerId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null
  );
}
