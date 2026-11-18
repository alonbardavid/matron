import { eq } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { user } from "@backend/db-models/arch-auth";
import { getDb } from "@backend/db-models/db";
import { householdPermissions } from "./permissions";

const log = logger("household/owners");

/** A role as it is stored or asked for: a string, a comma-separated list or an array. */
function rolesIn(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values
    .flatMap((v) => String(v).split(","))
    .map((role) => role.trim())
    .filter(Boolean);
}

/** Only an owner makes someone an owner: an admin cannot, themselves included. */
export function requireOwnerGrant(principal: Principal, role: unknown): void {
  if (householdPermissions.can(principal.role, "manage_owners")) return;
  if (!rolesIn(role).includes("owner")) return;
  log.warn("owner grant refused", { userId: principal.userId, role: principal.role });
  throw new DomainError("FORBIDDEN", "Only an owner can make someone an owner");
}

/** Only an owner changes an owner's account: its role, password, sessions, or the account itself. */
export async function requireOwnerAccess(
  principal: Principal,
  userId: string,
): Promise<void> {
  if (householdPermissions.can(principal.role, "manage_owners")) return;
  const target = await getDb()
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .get();
  if (!rolesIn(target?.role).includes("owner")) return;
  log.warn("owner change refused", { userId: principal.userId, targetUserId: userId });
  throw new DomainError("FORBIDDEN", "Only an owner can change an owner's account");
}
