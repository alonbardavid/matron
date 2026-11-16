import type { ReactNode } from "react";
import { Button, Group, Text } from "@mantine/core";
import type { Branch } from "@shared/contract/arch/branches";
import { useNavigate } from "react-router-dom";
import { withBranch } from "@frontend/api/branch";
import { useMe } from "@frontend/auth/useMe";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { useBranchActions, type OnOutOfDate } from "../useBranchActions";
import { BranchStatusBadge } from "./BranchStatusBadge";

interface BranchRowProps {
  branch: Branch;
  current: string;
  /** The title of the chat the branch was built from, when known. */
  title?: string | null;
  onOutOfDate?: OnOutOfDate;
  /** Opens the branch's build chat: to continue it, or to read it once archived. */
  onChat?: (sessionId: string) => void;
  /** More actions, from whoever lists the branch, shown before the branch's own. */
  children?: ReactNode;
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

/**
 * What can be done with the branch: chat with its builder, try it, abandon it,
 * review it once it is ready, and for owners merge it or update it with main. An archived branch
 * keeps only its chat.
 */
function BranchActions({ branch, current, onOutOfDate, onChat }: BranchRowProps) {
  const { me, can, isOwner, canReview } = useMe();
  const navigate = useNavigate();
  const { switching, abandonAndLeave } = useBranchActions(branch, onOutOfDate);
  const isCurrent = branch.id === current;
  const archived = branch.archivedAt !== null;
  const mine = me !== null && branch.userId === me.id;
  // Mirrors the services: the session's chat is its creator's and the owner's;
  // owners abandon any branch, a builder the ones they started.
  const canChat = branch.sessionViewable && (mine || isOwner);
  const canAbandon = can("merge") || (can("create") && mine);

  return (
    <>
      {canChat ? (
        <Button size="xs" variant="light" onClick={() => onChat?.(branch.buildSessionId)}>
          Chat
        </Button>
      ) : (
        !branch.sessionViewable && (
          <Text size="xs" c="dimmed">
            Session cleared
          </Text>
        )
      )}
      {!archived &&
        (isCurrent ? (
          <Text size="xs" c="dimmed">
            Trying
          </Text>
        ) : (
          <Button
            size="xs"
            variant="default"
            disabled={branch.status !== "ready"}
            loading={switching.isPending}
            onClick={() => switching.mutate(branch.id)}
          >
            Try
          </Button>
        ))}
      {!archived && canAbandon && (
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
      {!archived && canReview && branch.status === "ready" && (
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
    </>
  );
}

/** A branch as a list row: name, status and who made it, the actions beside or below. */
export function BranchRow(props: BranchRowProps) {
  const { branch, title, children } = props;
  return (
    <Group
      justify="space-between"
      px="md"
      py="sm"
      wrap="wrap"
      style={branch.archivedAt !== null ? { opacity: 0.7 } : undefined}
    >
      <div style={{ minWidth: 0, flex: "1 1 200px" }}>
        <Group gap="xs" wrap="nowrap">
          <Text size="sm" fw={500} truncate>
            {branch.name}
          </Text>
          <BranchStatusBadge status={branch.status} />
        </Group>
        {title && (
          <Text size="xs" truncate>
            {title}
          </Text>
        )}
        <BranchMeta branch={branch} />
      </div>
      <Group gap="xs" wrap="nowrap">
        {children}
        <BranchActions {...props} />
      </Group>
    </Group>
  );
}
