import { asc } from "drizzle-orm";
import { user } from "@backend/db-models/arch-auth";
import { getDb } from "@backend/db-models/db";
import type { Principal } from "@backend/commons/principal";
import type { HouseholdUser } from "@shared/contract/app/users";
import { avatarUrlOf } from "./avatar";
import { memberPermissions } from "./permissions";

/** Everyone in the household, for sharing, assigning and attendance. */
export async function listHouseholdUsers(principal: Principal): Promise<HouseholdUser[]> {
  memberPermissions.require(principal, "view");
  const rows = await getDb()
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      image: user.image,
    })
    .from(user)
    .orderBy(asc(user.name));
  return rows.map(({ image, ...row }) => ({ ...row, avatarUrl: avatarUrlOf(image) }));
}

/** The ids in `ids` that name household members, in order and without repeats. */
export async function knownUserIds(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const known = new Set(
    (await getDb().select({ id: user.id }).from(user)).map((r) => r.id),
  );
  return [...new Set(ids)].filter((id) => known.has(id));
}
