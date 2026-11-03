import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
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

/**
 * What the Build button does: the current branch's session if there is one,
 * otherwise the latest planning session, otherwise an empty chat whose
 * session is created by the first message.
 */
export function useStartBuild() {
  const buildChat = useBuildChat();
  const { currentBranch } = useBranches();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (currentBranch) {
      buildChat.open(currentBranch.buildSessionId);
      return;
    }
    setBusy(true);
    try {
      const sessions = await queryClient.fetchQuery(orpc.sessions.list.queryOptions());
      const planning = sessions
        .filter((session) => session.status === "planning" && session.archivedAt === null)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (planning) {
        buildChat.open(planning.id);
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

/** An empty chat; nothing is stored until the first message. */
export function useNewSession() {
  const buildChat = useBuildChat();
  return { start: buildChat.openNew };
}
