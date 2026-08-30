import { useConvexMutation } from '@/app/hooks/use-convex-mutation';

export function useGenerateUploadUrl() {
  return useConvexMutation('files/mutations:generateUploadUrl');
}

export function useBulkArchiveConversations() {
  return useConvexMutation('conversations/mutations:bulkArchiveConversations');
}

export function useBulkCloseConversations() {
  return useConvexMutation('conversations/mutations:bulkCloseConversations');
}

export function useBulkReopenConversations() {
  return useConvexMutation('conversations/mutations:bulkReopenConversations');
}

export function useBulkSpamConversations() {
  return useConvexMutation('conversations/mutations:bulkSpamConversations');
}

export function useBulkUnarchiveConversations() {
  return useConvexMutation(
    'conversations/mutations:bulkUnarchiveConversations',
  );
}

export function useSendMessageViaConnector() {
  return useConvexMutation('conversations/mutations:sendMessageViaConnector');
}

export function useComposeEmailConversation() {
  return useConvexMutation('conversations/mutations:composeEmailConversation');
}

export function useCloseConversation() {
  return useConvexMutation('conversations/mutations:closeConversation');
}

export function useReopenConversation() {
  return useConvexMutation('conversations/mutations:reopenConversation');
}

export function useAssignConversation() {
  return useConvexMutation('conversations/mutations:assignConversation');
}

export function useAssignConversationTeam() {
  return useConvexMutation('conversations/mutations:assignConversationTeam');
}

export function useMarkAsRead() {
  return useConvexMutation('conversations/mutations:markConversationAsRead');
}

export function useMarkAsSpam() {
  return useConvexMutation('conversations/mutations:markConversationAsSpam');
}

export function useDeleteConversation() {
  return useConvexMutation('conversations/mutations:deleteConversation');
}

export function useDownloadAttachments() {
  return useConvexMutation('conversations/mutations:downloadAttachments');
}

export function useUndoSendMessage() {
  return useConvexMutation('conversations/mutations:undoSendMessage');
}

export function useRetrySendMessage() {
  return useConvexMutation('conversations/mutations:retrySendMessage');
}

export function useDiscardOutboundMessage() {
  return useConvexMutation('conversations/mutations:discardOutboundMessage');
}
