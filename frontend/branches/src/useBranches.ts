import { useQuery } from "@tanstack/react-query";
import type { Branch } from "@shared/contract/arch/branches";
import { MAIN_BRANCH, urlForBranch } from "@frontend/api/branch";
import { orpc } from "@frontend/api/orpc";
import { useMe } from "@frontend/auth/useMe";

export { MAIN_BRANCH } from "@frontend/api/branch";

export function useBranches() {
  const { can } = useMe();
  const query = useQuery(
    orpc.branches.list.queryOptions({ enabled: can("view"), staleTime: 15_000 }),
  );
  // What the server resolved this tab's ?branch= to: main when it names nothing live.
  const current = query.data?.current ?? MAIN_BRANCH;
  const all: Branch[] = query.data?.branches ?? [];
  // Live branches are the ones to switch to and act on; archived ones are history.
  const branches = all.filter((branch) => branch.archivedAt === null);
  const archived = all.filter((branch) => branch.archivedAt !== null);
  const currentBranch = branches.find((branch) => branch.id === current) ?? null;

  return {
    query,
    branches,
    archived,
    current,
    currentBranch,
    onMain: current === MAIN_BRANCH,
    canView: can("view"),
  };
}

/** Loads the current page on another branch: the bundle differs, so it is a full load. */
export function switchBranch(branch: string): Promise<void> {
  window.location.assign(urlForBranch(branch));
  return new Promise(() => undefined); // the page is going away
}

export function branchLabel(branch: Branch | null, current: string): string {
  if (current === MAIN_BRANCH) return "main";
  return branch?.name ?? current;
}
