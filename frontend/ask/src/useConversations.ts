import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifyError } from "@frontend/api/errors";
import { branchParam, MAIN_BRANCH } from "@frontend/api/branch";
import { orpc } from "@frontend/api/orpc";
import type { Conversation } from "@shared/contract/app/conversations";
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

/** A conversation is continued only on the branch it was started on. */
export function onThisBranch(conversation: Conversation): boolean {
  return conversation.branch === (branchParam() ?? MAIN_BRANCH);
}

/**
 * What the Ask button does: open an empty panel, whose conversation is
 * created by the first message. Earlier conversations are on the Conversations page.
 */
export function useStartAsk() {
  const askChat = useAskChat();
  return { start: askChat.openNew, startNew: askChat.openNew };
}
