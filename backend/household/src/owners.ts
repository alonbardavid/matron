import { eq } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { user } from "@backend/db-models/arch-auth";
import { getDb } from "@backend/db-models/db";
import { householdPermissions } from "./permissions";

const log = logger("household/owners");

/** A change to the household's users: the roles it grants, and whose account it acts on. */
export interface UserChange {
  roles: readonly string[];
  userId?: string;
}

/**
 * Only an owner makes someone an owner, or changes an owner's account (role,
 * password, removal, ban, sessions): an admin cannot raise anyone, themselves
 * included, to owner, nor take over or remove one.
 */
export async function requireUserChange(
  principal: Principal,
  change: UserChange,
): Promise<void> {
  householdPermissions.require(principal, "manage");
  if (householdPermissions.can(principal.role, "manage_owners")) return;
  if (change.roles.includes("owner")) {
    log.warn("owner grant refused", { userId: principal.userId, role: principal.role });
    throw new DomainError("FORBIDDEN", "Only an owner can make someone an owner");
  }
  if (change.userId) {
    const target = await getDb()
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, change.userId))
      .get();
    if (target?.role === "owner") {
      log.warn("owner change refused", {
        userId: principal.userId,
        targetUserId: change.userId,
      });
      throw new DomainError("FORBIDDEN", "Only an owner can change an owner's account");
    }
  }
}
