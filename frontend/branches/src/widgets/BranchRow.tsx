import { Button, Group, Stack, Table, Text } from "@mantine/core";
import type { Branch } from "@shared/contract/arch/branches";
import { useNavigate } from "react-router-dom";
import { withBranch } from "@frontend/api/branch";
import { useMe } from "@frontend/auth/useMe";
import { Card } from "@frontend/ds/Card";
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

/** Who made the branch and when, and when it was archived. */
function BranchMeta({ branch }: { branch: Branch }) {
  return (
    <Text size="xs" c="dimmed">
      {branch.userName} · {new Date(branch.createdAt).toLocaleString()}
      {branch.archivedAt !== null &&
        ` · archived ${new Date(branch.archivedAt).toLocaleString()}`}
    </Text>
  );
}

/** Merge, or Update when main moved since the branch took it in. */
export function MergeButton({
  branch,
  onOutOfDate,
}: {
  branch: Branch;
  onOutOfDate?: OnOutOfDate;
}) {
  const { merge, outOfDate, requestMainPull } = useBranchActions(branch, onOutOfDate);
  return outOfDate ? (
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
  );
}

/** What can be done with the branch: open, review, merge or update, abandon; view an archived one's session. */
function BranchActions({ branch, current, onOutOfDate, onViewSession }: BranchRowProps) {
  const { can, canReview } = useMe();
  const navigate = useNavigate();
  const { switching, abandonAndLeave } = useBranchActions(branch, onOutOfDate);
  const isCurrent = branch.id === current;
  const archived = branch.archivedAt !== null;

  return (
    <>
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
      {!archived && canReview && (
        <Button
          size="xs"
          variant="default"
          onClick={() => navigate(withBranch(`/branches/${branch.id}/review`))}
        >
          Review
        </Button>
      )}
      {!archived && can("merge") && (
        <MergeButton branch={branch} onOutOfDate={onOutOfDate} />
      )}
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
    </>
  );
}

/** A branch as a table row, for wide screens. */
export function BranchRow(props: BranchRowProps) {
  const { branch } = props;
  return (
    <Table.Tr style={branch.archivedAt !== null ? { opacity: 0.7 } : undefined}>
      <Table.Td>
        <Text fw={500}>{branch.name}</Text>
        <BranchMeta branch={branch} />
      </Table.Td>
      <Table.Td>
        <BranchStatusBadge status={branch.status} />
      </Table.Td>
      <Table.Td>
        <Group gap="xs" justify="flex-end" wrap="nowrap">
          <BranchActions {...props} />
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

/** A branch as a card, for phones: name and status on top, the actions below. */
export function BranchCard(props: BranchRowProps) {
  const { branch } = props;
  return (
    <Card style={branch.archivedAt !== null ? { opacity: 0.7 } : undefined}>
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <div style={{ minWidth: 0 }}>
            <Text fw={500} truncate>
              {branch.name}
            </Text>
            <BranchMeta branch={branch} />
          </div>
          <BranchStatusBadge status={branch.status} />
        </Group>
        <Group gap="xs">
          <BranchActions {...props} />
        </Group>
      </Stack>
    </Card>
  );
}
