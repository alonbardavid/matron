import { Badge } from "@mantine/core";
import type { BuildSession } from "@shared/contract/arch/sessions";
import { statusColor } from "@frontend/ds/palette";

/** The session's last status; an archived session shows it greyed out. */
export function SessionStatusBadge({
  status,
  archived = false,
}: {
  status: BuildSession["status"];
  archived?: boolean;
}) {
  return (
    <Badge
      size="xs"
      variant={archived ? "outline" : "light"}
      color={archived ? "gray" : statusColor(status)}
    >
      {status}
    </Badge>
  );
}
