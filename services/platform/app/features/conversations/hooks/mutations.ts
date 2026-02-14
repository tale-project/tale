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
  return useConvexMutation(api.conversations.mutations.closeConversation);
}

export function useReopenConversation() {
  return useConvexMutation(api.conversations.mutations.reopenConversation);
}

export function useMarkAsRead() {
  return useConvexMutation(api.conversations.mutations.markConversationAsRead);
}

export function useMarkAsSpam() {
  return useConvexMutation(api.conversations.mutations.markConversationAsSpam);
}
