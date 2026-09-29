import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

/** The editor owns send feedback; other callers keep the hook's default toast. */
interface ErrorFeedbackOptions {
  errorToast?: false;
}

export function useGenerateUploadUrl(options?: ErrorFeedbackOptions) {
  return useBackendMutation('files/mutations:generateUploadUrl', options);
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

/** Every caller reports a failed send itself — the message editor's send
 * feedback, the bulk send's one summary toast — so the default toast stays
 * quiet. */
export function useSendMessageViaConnector() {
  return useBackendMutation('conversations/mutations:sendMessageViaConnector', {
    errorToast: false,
  });
}

export function useComposeEmailConversation(options?: ErrorFeedbackOptions) {
  return useBackendMutation(
    'conversations/mutations:composeEmailConversation',
    options,
  );
}

// Each caller of the writes below that opt out of the default toast — the
// conversation header, the panel and the assignee picker — reports a failure
// in its own toast, under the verb's own title and with the refusal's words.
// The default toast would report the same failure a second time.

export function useCloseConversation() {
  return useBackendMutation('conversations/mutations:closeConversation', {
    errorToast: false,
  });
}

export function useReopenConversation() {
  return useBackendMutation('conversations/mutations:reopenConversation', {
    errorToast: false,
  });
}

export function useAssignConversation() {
  return useBackendMutation('conversations/mutations:assignConversation', {
    errorToast: false,
  });
}

export function useAssignConversationTeam() {
  return useBackendMutation('conversations/mutations:assignConversationTeam', {
    errorToast: false,
  });
}

// Keeps the default toast: its one caller (the panel, marking a conversation
// read as it opens) only logs a failure.
export function useMarkAsRead() {
  return useBackendMutation('conversations/mutations:markConversationAsRead');
}

export function useMarkAsSpam() {
  return useBackendMutation('conversations/mutations:markConversationAsSpam', {
    errorToast: false,
  });
}

export function useDeleteConversation() {
  return useBackendMutation('conversations/mutations:deleteConversation', {
    errorToast: false,
  });
}

export function useUndoSendMessage() {
  return useBackendMutation('conversations/mutations:undoSendMessage', {
    errorToast: false,
  });
}

export function useRetrySendMessage() {
  return useBackendMutation('conversations/mutations:retrySendMessage', {
    errorToast: false,
  });
}

export function useDiscardOutboundMessage() {
  return useBackendMutation('conversations/mutations:discardOutboundMessage', {
    errorToast: false,
  });
}
