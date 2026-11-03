import { Button, Group, Table, Text } from "@mantine/core";
import type { Branch } from "@shared/contract/arch/branches";
import { useMe } from "@frontend/auth/useMe";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { useBranchActions, type OnOutOfDate } from "../useBranchActions";
import { BranchStatusBadge } from "./BranchStatusBadge";

interface BranchRowProps {
  branch: Branch;
  current: string;
  onOutOfDate?: OnOutOfDate;
  /** Opens the branch's build chat for reading. */
  onViewSession?: (sessionId: string) => void;
}

export function BranchRow({
  branch,
  current,
  onOutOfDate,
  onViewSession,
}: BranchRowProps) {
  const { can } = useMe();
  const { merge, switching, outOfDate, requestMainPull, abandonAndLeave } =
    useBranchActions(branch, onOutOfDate);
  const isCurrent = branch.id === current;
  const archived = branch.archivedAt !== null;

  return (
    <Table.Tr style={archived ? { opacity: 0.7 } : undefined}>
      <Table.Td>
        <Text fw={500}>{branch.name}</Text>
        <Text size="xs" c="dimmed">
          {branch.userName} · {new Date(branch.createdAt).toLocaleString()}
          {branch.archivedAt !== null &&
            ` · archived ${new Date(branch.archivedAt).toLocaleString()}`}
        </Text>
      </Table.Td>
      <Table.Td>
        <BranchStatusBadge status={branch.status} />
      </Table.Td>
      <Table.Td>
        <Group gap="xs" justify="flex-end" wrap="nowrap">
          {archived ? (
            branch.sessionViewable ? (
              <Button
                size="xs"
                variant="default"
                onClick={() => onViewSession?.(branch.buildSessionId)}
              >
                View session
              </Button>
            ) : (
              <Text size="xs" c="dimmed">
                Session cleared
              </Text>
            )
          ) : isCurrent ? (
            <Text size="xs" c="dimmed">
              Current
            </Text>
          ) : (
            <Button
              size="xs"
              variant="default"
              disabled={branch.status !== "ready"}
              loading={switching.isPending}
              onClick={() => switching.mutate(branch.id)}
            >
              Open
            </Button>
          )}
          {!archived &&
            can("merge") &&
            (outOfDate ? (
              <Button size="xs" color="yellow" onClick={requestMainPull}>
                Update
              </Button>
            ) : (
              <Button
                size="xs"
                color="sage"
                disabled={branch.status !== "ready"}
                loading={merge.isPending}
                onClick={() => merge.mutate()}
              >
                {branch.status === "merging" ? "Merging" : "Merge"}
              </Button>
            ))}
          {!archived && can("merge") && (
            <ConfirmButton
              size="xs"
              variant="subtle"
              color="red"
              message={`Abandon ${branch.name}? Its code and data are discarded.`}
              confirmLabel="Abandon"
              onConfirm={() => abandonAndLeave(current)}
            >
              Abandon
            </ConfirmButton>
          )}
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}
