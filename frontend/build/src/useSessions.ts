import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { branchParam } from "@frontend/api/branch";
import { orpc } from "@frontend/api/orpc";
import { useMe } from "@frontend/auth/useMe";
import { useBranches } from "@frontend/branches/useBranches";
import { useBuildChat } from "./BuildChatContext";

export function useSessions() {
  const { can } = useMe();
  return useQuery(
    orpc.sessions.list.queryOptions({ enabled: can("create"), staleTime: 15_000 }),
  );
}

export function useArchiveSession() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.sessions.archive.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.sessions.key() }),
      onError: (err) => notifyError(err, "Could not archive the session"),
    }),
  );
}

export function useClearSession() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.sessions.clear.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.sessions.key() }),
      onError: (err) => notifyError(err, "Could not clear the session"),
    }),
  );
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.sessions.create.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.sessions.key() }),
    }),
  );
}

const CLOSED = new Set(["closed", "merged", "abandoned"]);

/**
 * What the Build button does: on a live branch, that branch's session; on
 * main, the latest session that is still open, otherwise an empty chat whose
 * session is created by the first message. A tab left on a branch that was
 * merged or abandoned since is as good as on main: the branch's session is
 * archived, and Build never opens an archived one.
 */
export function useStartBuild() {
  const buildChat = useBuildChat();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      if (branchParam()) {
        const { current, branches } = await queryClient.fetchQuery(
          orpc.branches.list.queryOptions(),
        );
        const branch = branches.find((item) => item.id === current);
        if (branch && branch.archivedAt === null) {
          buildChat.open(branch.buildSessionId);
          return;
        }
      }
      const sessions = await queryClient.fetchQuery(orpc.sessions.list.queryOptions());
      const latest = sessions
        .filter((session) => session.archivedAt === null && !CLOSED.has(session.status))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (latest) {
        buildChat.open(latest.id);
        return;
      }
      buildChat.openNew();
    } catch (err) {
      notifyError(err, "Could not open the build chat");
    } finally {
      setBusy(false);
    }
  };

  return { start, busy };
}

/**
 * An empty chat; nothing is stored until the first message. A new build is
 * started from main: `onBranch` is the live branch this tab is on, where the
 * server refuses one.
 */
export function useNewSession() {
  const buildChat = useBuildChat();
  const { currentBranch } = useBranches();
  return { start: buildChat.openNew, onBranch: currentBranch };
}
