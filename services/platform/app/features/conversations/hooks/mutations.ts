import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useBulkArchiveConversations() {
  return useConvexMutation(
    api.conversations.mutations.bulkArchiveConversations,
  );
}

export function useBulkCloseConversations() {
  return useConvexMutation(api.conversations.mutations.bulkCloseConversations);
}

export function useBulkReopenConversations() {
  return useConvexMutation(api.conversations.mutations.bulkReopenConversations);
}

export function useBulkSpamConversations() {
  return useConvexMutation(api.conversations.mutations.bulkSpamConversations);
}

export function useBulkUnarchiveConversations() {
  return useConvexMutation(
    api.conversations.mutations.bulkUnarchiveConversations,
  );
}

export function useSendMessageViaConnector() {
  return useConvexMutation(api.conversations.mutations.sendMessageViaConnector);
}

export function useComposeEmailConversation() {
  return useConvexMutation(
    api.conversations.mutations.composeEmailConversation,
  );
}

export function useCloseConversation() {
  return useConvexMutation(api.conversations.mutations.closeConversation);
}

export function useReopenConversation() {
  return useConvexMutation(api.conversations.mutations.reopenConversation);
}

export function useAssignConversation() {
  return useConvexMutation(api.conversations.mutations.assignConversation);
}

export function useAssignConversationTeam() {
  return useConvexMutation(api.conversations.mutations.assignConversationTeam);
}

export function useMarkAsRead() {
  return useConvexMutation(api.conversations.mutations.markConversationAsRead);
}

export function useMarkAsSpam() {
  return useConvexMutation(api.conversations.mutations.markConversationAsSpam);
}

export function useDeleteConversation() {
  return useConvexMutation(api.conversations.mutations.deleteConversation);
}

export function useDownloadAttachments() {
  return useConvexMutation(api.conversations.mutations.downloadAttachments);
}

export function useUndoSendMessage() {
  return useConvexMutation(api.conversations.mutations.undoSendMessage);
}

export function useRetrySendMessage() {
  return useConvexMutation(api.conversations.mutations.retrySendMessage);
}

export function useDiscardOutboundMessage() {
  return useConvexMutation(api.conversations.mutations.discardOutboundMessage);
}
