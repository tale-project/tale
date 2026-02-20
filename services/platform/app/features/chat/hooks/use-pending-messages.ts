import { useMemo, useEffect, useRef } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import type { FileAttachment } from '../types';
import type { ChatMessage } from './use-message-processing';

import { useChatLayout } from '../context/chat-layout-context';

interface UsePendingMessagesParams {
  threadId: string | undefined;
  realMessages: ChatMessage[];
}

/**
 * Hook to merge pending messages from context with real messages.
 * Shows optimistic user message immediately after navigation while data loads.
 */
export function usePendingMessages({
  threadId,
  realMessages,
}: UsePendingMessagesParams): ChatMessage[] {
  const { pendingMessage, setPendingMessage } = useChatLayout();
  const hasCleared = useRef(false);

  // Reset cleared flag when threadId changes
  useEffect(() => {
    hasCleared.current = false;
  }, [threadId]);

  // Clear pending message once real messages arrive
  useEffect(() => {
    if (
      realMessages.length > 0 &&
      pendingMessage &&
      pendingMessage.threadId === threadId &&
      !hasCleared.current
    ) {
      hasCleared.current = true;
      setPendingMessage(null);
    }
  }, [realMessages.length, pendingMessage, threadId, setPendingMessage]);

  return useMemo(() => {
    // Show optimistic message when:
    // 1. threadId matches pendingMessage.threadId (navigated to new thread)
    // 2. threadId is undefined but pendingMessage exists (still on index page during startTransition)
    // 3. pendingMessage.threadId is 'pending' (waiting for thread creation)
    const shouldShowPending =
      pendingMessage &&
      realMessages.length === 0 &&
      (pendingMessage.threadId === threadId ||
        threadId === undefined ||
        pendingMessage.threadId === 'pending');

    if (shouldShowPending) {
      const attachments: FileAttachment[] | undefined =
        pendingMessage.attachments?.map((a) => ({
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PendingMessageAttachment.fileId is a string from Convex Id serialization
          fileId: a.fileId as Id<'_storage'>,
          fileName: a.fileName,
          fileType: a.fileType,
          fileSize: a.fileSize,
        }));

      const optimisticMessage: ChatMessage = {
        id: `pending-${pendingMessage.timestamp.getTime()}`,
        key: `pending-${pendingMessage.timestamp.getTime()}`,
        content: pendingMessage.content,
        role: 'user',
        timestamp: pendingMessage.timestamp,
        attachments:
          attachments && attachments.length > 0 ? attachments : undefined,
      };
      return [optimisticMessage];
    }

    return realMessages;
  }, [threadId, realMessages, pendingMessage]);
}
