import { ActionIcon, Tooltip } from "@mantine/core";
import { IconRefresh } from "@frontend/ds/icons";

interface RefreshButtonProps {
  label: string;
  /** The listing is being read: the button spins until it lands. */
  fetching: boolean;
  onClick: () => void;
}

/** Reads a listing again, and shows that it is doing so. */
export function RefreshButton({ label, fetching, onClick }: RefreshButtonProps) {
  return (
    <Tooltip label="Read again">
      <ActionIcon
        variant="default"
        aria-label={label}
        loading={fetching}
        onClick={onClick}
      >
        <IconRefresh size={16} />
      </ActionIcon>
    </Tooltip>
  );
}
