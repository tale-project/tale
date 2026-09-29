import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

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

// A status, assignment or message write below raises its own failure toast:
// the verb's title, and the refusal's words. Its callers — the conversation
// header, the panel and the assignee picker — call `mutate` and add no
// failure toast of their own: react-query drops a `mutate` call's own
// `onError` once another call starts on the same hook (Retry on one failed
// message, then on the next; a second pick) or once the caller unmounts
// before the write settles, and the failure would go unreported. The write's
// own toast fires for every call.

export function useCloseConversation() {
  const { t } = useT('conversations');
  return useBackendMutation('conversations/mutations:closeConversation', {
    errorToast: {
      title: t('header.toast.closeFailed'),
      description: failureDetail,
    },
  });
}

export function useReopenConversation() {
  const { t } = useT('conversations');
  return useBackendMutation('conversations/mutations:reopenConversation', {
    errorToast: {
      title: t('header.toast.reopenFailed'),
      description: failureDetail,
    },
  });
}

export function useAssignConversation() {
  const { t } = useT('conversations');
  return useBackendMutation('conversations/mutations:assignConversation', {
    errorToast: { title: t('header.assignError'), description: failureDetail },
  });
}

export function useAssignConversationTeam() {
  const { t } = useT('conversations');
  return useBackendMutation('conversations/mutations:assignConversationTeam', {
    errorToast: { title: t('header.assignError'), description: failureDetail },
  });
}

// Keeps the default toast: its one caller (the panel, marking a conversation
// read as it opens) only logs a failure.
export function useMarkAsRead() {
  return useBackendMutation('conversations/mutations:markConversationAsRead');
}

export function useMarkAsSpam() {
  const { t } = useT('conversations');
  return useBackendMutation('conversations/mutations:markConversationAsSpam', {
    errorToast: {
      title: t('header.toast.markAsSpamFailed'),
      description: failureDetail,
    },
  });
}

export function useDeleteConversation() {
  const { t } = useT('conversations');
  return useBackendMutation('conversations/mutations:deleteConversation', {
    errorToast: {
      title: t('panel.deleteFailed'),
      description: failureDetail,
    },
  });
}

export function useUndoSendMessage() {
  const { t } = useT('conversations');
  return useBackendMutation('conversations/mutations:undoSendMessage', {
    errorToast: {
      title: t('panel.undoSendFailed'),
      description: failureDetail,
    },
  });
}

export function useRetrySendMessage() {
  const { t } = useT('conversations');
  return useBackendMutation('conversations/mutations:retrySendMessage', {
    errorToast: {
      title: t('panel.retrySendFailed'),
      description: failureDetail,
    },
  });
}

export function useDiscardOutboundMessage() {
  const { t } = useT('conversations');
  return useBackendMutation('conversations/mutations:discardOutboundMessage', {
    errorToast: {
      title: t('panel.discardMessageFailed'),
      description: failureDetail,
    },
  });
}
