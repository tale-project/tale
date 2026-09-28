import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

/** A caller that reports the outcome itself — the editor's sends, the bulk
 * verbs — opts out of the hook's default failure toast. */
interface ErrorFeedbackOptions {
  errorToast?: false;
}

export function useGenerateUploadUrl(options?: ErrorFeedbackOptions) {
  return useBackendMutation('files/mutations:generateUploadUrl', options);
}

export function useBulkArchiveConversations(options?: ErrorFeedbackOptions) {
  return useBackendMutation(
    'conversations/mutations:bulkArchiveConversations',
    options,
  );
}

export function useBulkCloseConversations(options?: ErrorFeedbackOptions) {
  return useBackendMutation(
    'conversations/mutations:bulkCloseConversations',
    options,
  );
}

export function useBulkReopenConversations(options?: ErrorFeedbackOptions) {
  return useBackendMutation(
    'conversations/mutations:bulkReopenConversations',
    options,
  );
}

export function useBulkSpamConversations(options?: ErrorFeedbackOptions) {
  return useBackendMutation(
    'conversations/mutations:bulkSpamConversations',
    options,
  );
}

export function useBulkUnarchiveConversations(options?: ErrorFeedbackOptions) {
  return useBackendMutation(
    'conversations/mutations:bulkUnarchiveConversations',
    options,
  );
}

export function useSendMessageViaConnector(options?: ErrorFeedbackOptions) {
  return useBackendMutation(
    'conversations/mutations:sendMessageViaConnector',
    options,
  );
}

export function useComposeEmailConversation(options?: ErrorFeedbackOptions) {
  return useBackendMutation(
    'conversations/mutations:composeEmailConversation',
    options,
  );
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

export function useUndoSendMessage() {
  return useBackendMutation('conversations/mutations:undoSendMessage');
}

export function useRetrySendMessage() {
  return useBackendMutation('conversations/mutations:retrySendMessage');
}

export function useDiscardOutboundMessage() {
  return useBackendMutation('conversations/mutations:discardOutboundMessage');
}
