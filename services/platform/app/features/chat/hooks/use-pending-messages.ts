import { useMemo, useEffect } from 'react';

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
 *
 * For NEW threads (no real messages): shows optimistic user message to bridge
 * the navigation gap during thread creation.
 *
 * For EXISTING threads: appends optimistic user message at the end while the
 * real message is in-flight. Uses `lastMessageKey` (captured at send time) to
 * detect when the real message arrives — when the last key in realMessages
 * changes from the baseline, the optimistic message is dropped.
 */
export function usePendingMessages({
  threadId,
  realMessages,
}: UsePendingMessagesParams): ChatMessage[] {
  const { pendingMessage, setPendingMessage } = useChatLayout();

  // Derived scalars for the cleanup effect — avoids re-running on every
  // streaming update when only the message content (not the tail key) changes.
  const currentLastKey = realMessages[realMessages.length - 1]?.key;
  const hasMessages = realMessages.length > 0;

  // Clear pending message once the real message arrives
  useEffect(() => {
    if (!pendingMessage) return;

    // Only clear for matching thread
    const isMatchingThread =
      pendingMessage.threadId === threadId ||
      threadId === undefined ||
      pendingMessage.threadId === 'pending';
    if (!isMatchingThread) return;

    // For new threads: clear when any real message arrives
    if (hasMessages && pendingMessage.lastMessageKey === undefined) {
      setPendingMessage(null);
      return;
    }

    // For existing threads: clear when last key changes from baseline
    if (pendingMessage.lastMessageKey !== undefined) {
      if (
        currentLastKey !== undefined &&
        currentLastKey !== pendingMessage.lastMessageKey
      ) {
        setPendingMessage(null);
      }
    }
  }, [
    currentLastKey,
    hasMessages,
    pendingMessage,
    threadId,
    setPendingMessage,
  ]);

  return useMemo(() => {
    const isMatchingThread =
      pendingMessage &&
      (pendingMessage.threadId === threadId ||
        threadId === undefined ||
        pendingMessage.threadId === 'pending');

    if (!isMatchingThread) return realMessages;

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

    // New thread (no real messages yet): show only optimistic
    if (realMessages.length === 0) {
      return [optimisticMessage];
    }

    // Existing thread: append optimistic until real message arrives at the end
    if (
      pendingMessage.lastMessageKey !== undefined &&
      currentLastKey === pendingMessage.lastMessageKey
    ) {
      return [...realMessages, optimisticMessage];
    }

    // Real message arrived — return realMessages as-is (no duplicate)
    return realMessages;
  }, [threadId, realMessages, pendingMessage, currentLastKey]);
}
