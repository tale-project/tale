import { useState, useCallback } from 'react';

import type { ConversationItem } from '@/convex/conversations/types';

import { toast } from '@/app/hooks/use-toast';
import { toId, toIds } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import type { SelectionState } from '../types/selection';

import { isAllSelection } from '../types/selection';
import {
  useAddMessage,
  useBulkCloseConversations,
  useBulkReopenConversations,
} from './mutations';

function getSelectedConversationIds(
  selectionState: SelectionState,
  conversations: ConversationItem[],
) {
  return isAllSelection(selectionState)
    ? conversations.map((c) => c._id)
    : Array.from(selectionState.selectedIds);
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

  const { mutateAsync: bulkResolve } = useBulkCloseConversations();
  const { mutateAsync: bulkReopen } = useBulkReopenConversations();
  const { mutateAsync: addMessage } = useAddMessage();

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

  const handleSendMessages = useCallback(async () => {
    if (isBulkProcessing) return;

    setIsBulkProcessing(true);
    setBulkSendDialog({ isOpen: true, isSending: true });

    try {
      const conversationIds = getSelectedConversationIds(
        selectionState,
        conversations,
      );

      const results = await Promise.allSettled(
        conversationIds.map((conversationId) =>
          addMessage({
            conversationId: toId<'conversations'>(conversationId),
            organizationId,
            sender: 'Agent',
            content: 'Message sent',
            isCustomer: false,
            status: 'sent',
          }),
        ),
      );

      const successCount = results.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      const failedCount = results.filter((r) => r.status === 'rejected').length;

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
  }, [
    isBulkProcessing,
    selectionState,
    conversations,
    addMessage,
    organizationId,
    tConversations,
    onComplete,
  ]);

  const handleBulkResolve = useCallback(async () => {
    if (isBulkProcessing) return;

    setIsBulkProcessing(true);

    try {
      const conversationIds = getSelectedConversationIds(
        selectionState,
        conversations,
      );

      const result = await bulkResolve({
        conversationIds: toIds<'conversations'>(conversationIds),
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
        conversationIds: toIds<'conversations'>(conversationIds),
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

  return {
    isBulkProcessing,
    bulkSendDialog,
    openBulkSendDialog,
    closeBulkSendDialog,
    handleSendMessages,
    handleBulkResolve,
    handleBulkReopen,
  };
}
