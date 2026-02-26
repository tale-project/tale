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
 * Shows optimistic user message immediately after send — both for new threads
 * (during navigation) and existing threads (while waiting for Convex sync).
 *
 * Uses the `userMessageBaseline` stored at send time to detect when the real
 * message has been delivered, avoiding race conditions with ref-based tracking.
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

  const currentUserCount = useMemo(
    () => realMessages.filter((m) => m.role === 'user').length,
    [realMessages],
  );

  // Clear pending message once the real user message arrives
  useEffect(() => {
    if (
      pendingMessage &&
      currentUserCount > pendingMessage.userMessageBaseline &&
      (pendingMessage.threadId === threadId ||
        pendingMessage.threadId === 'pending') &&
      !hasCleared.current
    ) {
      hasCleared.current = true;
      setPendingMessage(null);
    }
  }, [currentUserCount, pendingMessage, threadId, setPendingMessage]);

  return useMemo(() => {
    const shouldShowPending =
      pendingMessage &&
      (pendingMessage.threadId === threadId ||
        threadId === undefined ||
        pendingMessage.threadId === 'pending');

    if (!shouldShowPending) return realMessages;

    // Real user message already arrived — no need for optimistic display
    if (currentUserCount > pendingMessage.userMessageBaseline) {
      return realMessages;
    }

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

    if (realMessages.length === 0) {
      return [optimisticMessage];
    }

    return [...realMessages, optimisticMessage];
  }, [threadId, realMessages, pendingMessage, currentUserCount]);
}
