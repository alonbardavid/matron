import type { BranchStatus } from "@backend/db-models/arch-branches";
import type { BuildSessionStatus } from "@backend/db-models/arch-sessions";

/**
 * Whether a session may be archived by hand: once, and only while no branch
 * is still deployed for it. The session's own status does not matter, so a
 * session the automatic archiving missed can always be put away.
 */
export function canArchiveSession(
  session: { status: BuildSessionStatus; archivedAt: Date | null },
  branch: { status: BranchStatus; archivedAt: Date | null } | null,
): boolean {
  if (session.archivedAt) return false;
  return branch === null || branch.archivedAt !== null;
}

/** Whether a session's data may be wiped: only once archived, and only once. */
export function canClearSession(session: {
  archivedAt: Date | null;
  clearedAt: Date | null;
}): boolean {
  return session.archivedAt !== null && session.clearedAt === null;
}
