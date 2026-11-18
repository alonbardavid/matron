import { useState } from "react";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { branchParam } from "@frontend/api/branch";
import { orpc } from "@frontend/api/orpc";
import { useMe } from "@frontend/auth/useMe";
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
 * What the Build button does. On a branch it is that branch's session and no
 * other, whether the branch is live or was merged or abandoned since the tab
 * came to it. On main it is the latest session that is still open and is not
 * on its way out with a branch being merged or abandoned, otherwise an empty
 * chat whose session is created by the first message.
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
        if (branch?.sessionViewable) buildChat.open(branch.buildSessionId);
        else {
          notifications.show({
            color: "yellow",
            message:
              "This branch has no build chat left. Switch to main to start a build.",
          });
        }
        return;
      }
      const sessions = await queryClient.fetchQuery(orpc.sessions.list.queryOptions());
      const latest = sessions
        .filter(
          (session) =>
            session.archivedAt === null &&
            !session.closing &&
            !CLOSED.has(session.status),
        )
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
 * started from main: `onBranch` says this tab is on a branch, where the
 * server refuses one.
 */
export function useNewSession() {
  const buildChat = useBuildChat();
  return { start: buildChat.openNew, onBranch: branchParam() !== null };
}
