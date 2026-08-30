import { useState, useCallback } from 'react';

import { toast } from '@/app/hooks/use-toast';
import type { ConversationItem } from '@/convex/conversations/types';
import { useT } from '@/lib/i18n/client';

import type { SelectionState } from '../types/selection';
import { isAllSelection } from '../types/selection';
import {
  useBulkArchiveConversations,
  useBulkCloseConversations,
  useBulkReopenConversations,
  useBulkSpamConversations,
  useBulkUnarchiveConversations,
  useSendMessageViaConnector,
} from './mutations';

const UNKNOWN_CONTACT_EMAIL = 'unknown@example.com';

export function getSelectedConversationIds(
  selectionState: SelectionState,
  conversations: ConversationItem[],
) {
  // Intersect the selected ids with the currently-visible (filtered)
  // conversations so bulk actions only ever touch rows the user can see.
  // This keeps a narrowed search from silently mutating now-hidden rows.
  return isAllSelection(selectionState)
    ? conversations.map((c) => c._id)
    : conversations
        .filter((c) => selectionState.selectedIds.has(c.id))
        .map((c) => c._id);
}

function getSelectedConversations(
  selectionState: SelectionState,
  conversations: ConversationItem[],
) {
  return isAllSelection(selectionState)
    ? conversations
    : conversations.filter((c) => selectionState.selectedIds.has(c._id));
}

interface UseBulkActionsOptions {
  organizationId: string;
  conversations: ConversationItem[];
  selectionState: SelectionState;
  onComplete: () => void;
}

export function useBulkActions({
  organizationId,
  conversations,
  selectionState,
  onComplete,
}: UseBulkActionsOptions) {
  const { t: tConversations } = useT('conversations');

  const { mutateAsync: bulkArchive } = useBulkArchiveConversations();
  const { mutateAsync: bulkResolve } = useBulkCloseConversations();
  const { mutateAsync: bulkReopen } = useBulkReopenConversations();
  const { mutateAsync: bulkSpam } = useBulkSpamConversations();
  const { mutateAsync: bulkUnarchive } = useBulkUnarchiveConversations();
  const { mutateAsync: sendMessageViaConnector } = useSendMessageViaConnector();

  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkSendDialog, setBulkSendDialog] = useState({
    isOpen: false,
    isSending: false,
  });

  const openBulkSendDialog = useCallback(() => {
    setBulkSendDialog({ isOpen: true, isSending: false });
  }, []);

  const closeBulkSendDialog = useCallback(() => {
    setBulkSendDialog({ isOpen: false, isSending: false });
  }, []);

  const handleSendMessages = useCallback(
    async (message: string) => {
      if (isBulkProcessing) return;

      const body = message.trim();
      if (!body) return;

      setIsBulkProcessing(true);
      setBulkSendDialog({ isOpen: true, isSending: true });

      try {
        const selectedConversations = getSelectedConversations(
          selectionState,
          conversations,
        );

        // Dispatch a real reply to each contact through the conversation's
        // connector — mirroring the single-conversation reply path. A
        // conversation without a usable contact email cannot be delivered, so
        // it is counted as a failure rather than silently dropped.
        const results = await Promise.allSettled(
          selectedConversations.map((conversation) => {
            const contactEmail = conversation.contact.email;
            if (!contactEmail || contactEmail === UNKNOWN_CONTACT_EMAIL) {
              return Promise.reject(
                new Error(tConversations('panel.contactEmailNotFound')),
              );
            }

            const subject =
              conversation.subject || tConversations('panel.defaultSubject');
            const replySubject = tConversations('panel.replySubjectPrefix', {
              subject,
            });

            return sendMessageViaConnector({
              conversationId: conversation._id,
              organizationId,
              connectorName: conversation.connectorName ?? 'outlook',
              content: body,
              to: [contactEmail],
              subject: replySubject,
              text: body,
            });
          }),
        );

        const successCount = results.filter(
          (r) => r.status === 'fulfilled',
        ).length;
        const failedCount = results.filter(
          (r) => r.status === 'rejected',
        ).length;

        toast({
          title: tConversations('bulk.messagesSent'),
          description: tConversations('bulk.messagesSentDescription', {
            successCount,
            failedCount,
          }),
          variant: successCount > 0 ? 'default' : 'destructive',
        });

        setBulkSendDialog({ isOpen: false, isSending: false });
        onComplete();
      } catch (error) {
        console.error('Error sending messages:', error);
        toast({
          title: tConversations('bulk.sendFailed'),
          variant: 'destructive',
        });
        setBulkSendDialog({ isOpen: false, isSending: false });
      } finally {
        setIsBulkProcessing(false);
      }
    },
    [
      isBulkProcessing,
      selectionState,
      conversations,
      sendMessageViaConnector,
      organizationId,
      tConversations,
      onComplete,
    ],
  );

  const handleBulkResolve = useCallback(async () => {
    if (isBulkProcessing) return;

    setIsBulkProcessing(true);

    try {
      const conversationIds = getSelectedConversationIds(
        selectionState,
        conversations,
      );

      const result = await bulkResolve({
        conversationIds: conversationIds,
      });

      toast({
        title: tConversations('bulk.resolved'),
        description: tConversations('bulk.resolvedDescription', {
          successCount: result.successCount,
          failedCount: result.failedCount,
        }),
        variant: result.successCount > 0 ? 'default' : 'destructive',
      });

      onComplete();
    } catch (error) {
      console.error('Error resolving conversations:', error);
      toast({
        title: tConversations('bulk.resolveFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsBulkProcessing(false);
    }
  }, [
    isBulkProcessing,
    selectionState,
    conversations,
    bulkResolve,
    tConversations,
    onComplete,
  ]);

  const handleBulkReopen = useCallback(async () => {
    if (isBulkProcessing) return;

    setIsBulkProcessing(true);

    try {
      const conversationIds = getSelectedConversationIds(
        selectionState,
        conversations,
      );

      const result = await bulkReopen({
        conversationIds: conversationIds,
      });

      toast({
        title: tConversations('bulk.reopened'),
        description: tConversations('bulk.reopenedDescription', {
          successCount: result.successCount,
          failedCount: result.failedCount,
        }),
        variant: result.successCount > 0 ? 'default' : 'destructive',
      });

      onComplete();
    } catch (error) {
      console.error('Error reopening conversations:', error);
      toast({
        title: tConversations('bulk.reopenFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsBulkProcessing(false);
    }
  }, [
    isBulkProcessing,
    selectionState,
    conversations,
    bulkReopen,
    tConversations,
    onComplete,
  ]);

  const handleBulkSpam = useCallback(async () => {
    if (isBulkProcessing) return;

    setIsBulkProcessing(true);

    try {
      const conversationIds = getSelectedConversationIds(
        selectionState,
        conversations,
      );

      const result = await bulkSpam({
        conversationIds: conversationIds,
      });

      toast({
        title: tConversations('bulk.markedAsSpam'),
        description: tConversations('bulk.markedAsSpamDescription', {
          successCount: result.successCount,
          failedCount: result.failedCount,
        }),
        variant: result.successCount > 0 ? 'default' : 'destructive',
      });

      onComplete();
    } catch (error) {
      console.error('Error marking conversations as spam:', error);
      toast({
        title: tConversations('bulk.spamFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsBulkProcessing(false);
    }
  }, [
    isBulkProcessing,
    selectionState,
    conversations,
    bulkSpam,
    tConversations,
    onComplete,
  ]);

  const handleBulkArchive = useCallback(async () => {
    if (isBulkProcessing) return;

    setIsBulkProcessing(true);

    try {
      const conversationIds = getSelectedConversationIds(
        selectionState,
        conversations,
      );

      const result = await bulkArchive({
        conversationIds: conversationIds,
      });

      toast({
        title: tConversations('bulk.archived'),
        description: tConversations('bulk.archivedDescription', {
          successCount: result.successCount,
          failedCount: result.failedCount,
        }),
        variant: result.successCount > 0 ? 'default' : 'destructive',
      });

      onComplete();
    } catch (error) {
      console.error('Error archiving conversations:', error);
      toast({
        title: tConversations('bulk.archiveFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsBulkProcessing(false);
    }
  }, [
    isBulkProcessing,
    selectionState,
    conversations,
    bulkArchive,
    tConversations,
    onComplete,
  ]);

  const handleBulkUnarchive = useCallback(async () => {
    if (isBulkProcessing) return;

    setIsBulkProcessing(true);

    try {
      const conversationIds = getSelectedConversationIds(
        selectionState,
        conversations,
      );

      const result = await bulkUnarchive({
        conversationIds: conversationIds,
      });

      toast({
        title: tConversations('bulk.unarchived'),
        description: tConversations('bulk.unarchivedDescription', {
          successCount: result.successCount,
          failedCount: result.failedCount,
        }),
        variant: result.successCount > 0 ? 'default' : 'destructive',
      });

      onComplete();
    } catch (error) {
      console.error('Error unarchiving conversations:', error);
      toast({
        title: tConversations('bulk.unarchiveFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsBulkProcessing(false);
    }
  }, [
    isBulkProcessing,
    selectionState,
    conversations,
    bulkUnarchive,
    tConversations,
    onComplete,
  ]);

  return {
    isBulkProcessing,
    bulkSendDialog,
    openBulkSendDialog,
    closeBulkSendDialog,
    handleSendMessages,
    handleBulkResolve,
    handleBulkReopen,
    handleBulkSpam,
    handleBulkArchive,
    handleBulkUnarchive,
  };
}
