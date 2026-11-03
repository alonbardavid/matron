import { Button } from "@mantine/core";
import { useMe } from "@frontend/auth/useMe";
import { IconHammer } from "@frontend/ds/icons";
import { useStartBuild } from "../useSessions";

export function BuildButton() {
  const { can } = useMe();
  const { start, busy } = useStartBuild();
  if (!can("create")) return null;
  return (
    <Button
      size="xs"
      leftSection={<IconHammer />}
      loading={busy}
      onClick={() => void start()}
    >
      Build
    </Button>
  );
}
