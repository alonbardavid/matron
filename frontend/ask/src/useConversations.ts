import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { orpc } from "@frontend/api/orpc";
import { useAskChat } from "./AskChatContext";

export function useConversations() {
  return useQuery(orpc.conversations.list.queryOptions({ staleTime: 15_000 }));
}

export function useConversationActions() {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: orpc.conversations.key() });
  const create = useMutation(
    orpc.conversations.create.mutationOptions({ onSuccess: refresh }),
  );
  const archive = useMutation(
    orpc.conversations.archive.mutationOptions({
      onSuccess: refresh,
      onError: (err) => notifyError(err, "Could not archive the conversation"),
    }),
  );
  return { create, archive };
}

/**
 * What the Ask button does: open the latest conversation that is not
 * archived, or an empty panel whose conversation is created by the first
 * message.
 */
export function useStartAsk() {
  const askChat = useAskChat();
  const queryClient = useQueryClient();

  const start = async () => {
    try {
      const sessions = await queryClient.fetchQuery(
        orpc.conversations.list.queryOptions(),
      );
      const latest = sessions
        .filter((session) => session.archivedAt === null)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (latest) askChat.open(latest.id);
      else askChat.openNew();
    } catch (err) {
      notifyError(err, "Could not open the assistant");
    }
  };

  return { start, startNew: askChat.openNew };
}
