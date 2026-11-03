import { Box, Button, Container, Group, Text } from "@mantine/core";
import type { Branch } from "@shared/contract/arch/branches";
import { useMe } from "@frontend/auth/useMe";
import { ConfirmButton } from "@frontend/ds/ConfirmButton";
import { palette } from "@frontend/ds/palette";
import { useBranchActions, type OnOutOfDate } from "../useBranchActions";
import { MAIN_BRANCH, useBranches } from "../useBranches";

interface BranchBannerProps {
  onOutOfDate: OnOutOfDate;
}

export function BranchBanner({ onOutOfDate }: BranchBannerProps) {
  const { currentBranch, onMain, canView } = useBranches();
  if (!canView || onMain || !currentBranch) return null;
  return <Banner branch={currentBranch} onOutOfDate={onOutOfDate} />;
}

function Banner({ branch, onOutOfDate }: { branch: Branch; onOutOfDate: OnOutOfDate }) {
  const { can } = useMe();
  const { merge, switching, outOfDate, requestMainPull, abandonAndLeave } =
    useBranchActions(branch, onOutOfDate);
  const merging = branch.status === "merging" || merge.isPending;

  return (
    <Box bg={palette.warning} c={palette.warningText} py="xs">
      <Container size="lg">
        <Group justify="space-between" gap="sm">
          <Text size="sm">
            You are on branch <b>{branch.name}</b>. Data changes here are not kept when
            the branch is merged.
          </Text>
          <Group gap="xs">
            {can("merge") &&
              (outOfDate ? (
                <Button
                  size="xs"
                  color="yellow"
                  variant="filled"
                  onClick={requestMainPull}
                >
                  Update
                </Button>
              ) : (
                <Button
                  size="xs"
                  color="sage"
                  loading={merging}
                  disabled={branch.status !== "ready"}
                  onClick={() => merge.mutate()}
                >
                  {branch.status === "merging" ? "Merging" : "Merge"}
                </Button>
              ))}
            <Button
              size="xs"
              variant="default"
              loading={switching.isPending}
              onClick={() => switching.mutate(MAIN_BRANCH)}
            >
              Switch to main
            </Button>
            {can("merge") && (
              <ConfirmButton
                size="xs"
                variant="subtle"
                color="red"
                message={`Abandon ${branch.name}? Its code and data are discarded.`}
                confirmLabel="Abandon"
                onConfirm={() => abandonAndLeave(branch.id)}
              >
                Abandon
              </ConfirmButton>
            )}
          </Group>
        </Group>
      </Container>
    </Box>
  );
}
