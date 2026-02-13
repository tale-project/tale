import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useAddMessage() {
  return useConvexMutation(
    api.conversations.mutations.addMessageToConversation,
  );
}

export function useBulkCloseConversations() {
  return useConvexMutation(api.conversations.mutations.bulkCloseConversations);
}

export function useBulkReopenConversations() {
  return useConvexMutation(api.conversations.mutations.bulkReopenConversations);
}

export function useSendMessageViaIntegration() {
  return useConvexMutation(
    api.conversations.mutations.sendMessageViaIntegration,
  );
}

export function useCloseConversation() {
  const { mutateAsync } = useConvexMutation(
    api.conversations.mutations.closeConversation,
  );

  return mutateAsync;
}

export function useReopenConversation() {
  const { mutateAsync } = useConvexMutation(
    api.conversations.mutations.reopenConversation,
  );

  return mutateAsync;
}

export function useMarkAsRead() {
  const { mutateAsync } = useConvexMutation(
    api.conversations.mutations.markConversationAsRead,
  );

  return mutateAsync;
}

export function useMarkAsSpam() {
  const { mutateAsync } = useConvexMutation(
    api.conversations.mutations.markConversationAsSpam,
  );

  return mutateAsync;
}
