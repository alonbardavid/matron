import { Badge } from "@mantine/core";
import type { Branch } from "@shared/contract/arch/branches";
import { statusColor } from "@frontend/ds/palette";

export function BranchStatusBadge({ status }: { status: Branch["status"] }) {
  return (
    <Badge size="xs" variant="light" color={statusColor(status)}>
      {status}
    </Badge>
  );
}
