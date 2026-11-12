import { Badge } from "@mantine/core";
import type { Branch } from "@shared/contract/arch/branches";
import { statusColor } from "@frontend/ds/palette";

/** The branch's status; a merged branch a revert took back out reads "reverted". */
export function BranchStatusBadge({
  branch,
}: {
  branch: Pick<Branch, "status" | "revertedAt">;
}) {
  const label = branch.revertedAt !== null ? "reverted" : branch.status;
  return (
    <Badge size="xs" variant="light" color={statusColor(label)}>
      {label}
    </Badge>
  );
}
