import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import type { Branch } from "@shared/contract/arch/branches";
import { hasErrorCode, notifyError } from "@frontend/api/errors";
import { api, orpc } from "@frontend/api/orpc";
import { MAIN_BRANCH, switchBranch } from "./useBranches";

export type OnOutOfDate = (branch: Branch) => void;

/**
 * Merge, abandon and switch for one branch. Whether it is behind main comes
 * from the server with the branch; a merge refused for that reason refreshes it.
 */
export function useBranchActions(branch: Branch, onOutOfDate?: OnOutOfDate) {
  const queryClient = useQueryClient();
  const outOfDate = branch.behindMain;
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.branches.key() });

  const merge = useMutation({
    mutationFn: () => api.branches.merge({ id: branch.id }),
    onSuccess: () => {
      notifications.show({
        color: "sage",
        title: "Merging",
        message: `${branch.name} is being merged into main. It is archived once done.`,
      });
      void invalidate();
    },
    onError: (err) => {
      if (hasErrorCode(err, "CONFLICT")) {
        void invalidate();
        notifications.show({
          color: "yellow",
          title: "Main has new changes",
          message: "Update the branch with main before merging.",
        });
        return;
      }
      notifyError(err, "Could not merge");
    },
  });

  const abandon = useMutation({
    mutationFn: async () => {
      await api.branches.remove({ id: branch.id });
    },
    onSuccess: async () => {
      await invalidate();
    },
    onError: (err) => notifyError(err, "Could not abandon the branch"),
  });

  const switching = useMutation({
    mutationFn: (target: string) => switchBranch(target),
    onError: (err) => notifyError(err, "Could not switch branch"),
  });

  const requestMainPull = () => onOutOfDate?.(branch);

  const abandonAndLeave = async (currentBranchId: string) => {
    await abandon.mutateAsync();
    if (currentBranchId === branch.id) await switching.mutateAsync(MAIN_BRANCH);
  };

  return { merge, abandon, switching, outOfDate, requestMainPull, abandonAndLeave };
}
