import { useCallback } from "react";
import type { OnOutOfDate } from "@frontend/branches/useBranchActions";
import { useBuildChat } from "./BuildChatContext";

export function outOfDateMessage(branchName: string): string {
  return (
    `Branch ${branchName} cannot be merged because main has new changes. ` +
    "Bring the branch up to date with main, resolve any conflicts, and redeploy."
  );
}

/** The "Update" action: open the branch's chat and ask the builder to pull main. */
export function useOutOfDateAction(): OnOutOfDate {
  const buildChat = useBuildChat();
  return useCallback(
    (branch) =>
      buildChat.openWithMessage(branch.buildSessionId, outOfDateMessage(branch.name)),
    [buildChat],
  );
}
