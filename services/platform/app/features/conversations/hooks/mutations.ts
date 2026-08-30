import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useGenerateUploadUrl() {
  return useBackendMutation('files/mutations:generateUploadUrl');
}

export function useBulkArchiveConversations() {
  return useBackendMutation('conversations/mutations:bulkArchiveConversations');
}

export function useBulkCloseConversations() {
  return useBackendMutation('conversations/mutations:bulkCloseConversations');
}

export function useBulkReopenConversations() {
  return useBackendMutation('conversations/mutations:bulkReopenConversations');
}

export function useBulkSpamConversations() {
  return useBackendMutation('conversations/mutations:bulkSpamConversations');
}

export function useBulkUnarchiveConversations() {
  return useBackendMutation(
    'conversations/mutations:bulkUnarchiveConversations',
  );
}

export function useSendMessageViaConnector() {
  return useBackendMutation('conversations/mutations:sendMessageViaConnector');
}

export function useComposeEmailConversation() {
  return useBackendMutation('conversations/mutations:composeEmailConversation');
}

export function useCloseConversation() {
  return useBackendMutation('conversations/mutations:closeConversation');
}

export function useReopenConversation() {
  return useBackendMutation('conversations/mutations:reopenConversation');
}

export function useAssignConversation() {
  return useBackendMutation('conversations/mutations:assignConversation');
}

export function useAssignConversationTeam() {
  return useBackendMutation('conversations/mutations:assignConversationTeam');
}

export function useMarkAsRead() {
  return useBackendMutation('conversations/mutations:markConversationAsRead');
}

export function useMarkAsSpam() {
  return useBackendMutation('conversations/mutations:markConversationAsSpam');
}

export function useDeleteConversation() {
  return useBackendMutation('conversations/mutations:deleteConversation');
}

export function useDownloadAttachments() {
  return useBackendMutation('conversations/mutations:downloadAttachments');
}

export function useUndoSendMessage() {
  return useBackendMutation('conversations/mutations:undoSendMessage');
}

export function useRetrySendMessage() {
  return useBackendMutation('conversations/mutations:retrySendMessage');
}

export function useDiscardOutboundMessage() {
  return useBackendMutation('conversations/mutations:discardOutboundMessage');
}
