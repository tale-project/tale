import { useMemo, useEffect } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { useChatLayout } from '../context/chat-layout-context';
import type { FileAttachment } from '../types';
import type { ChatMessage } from './use-message-processing';

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
 *
 * For EDIT-AND-BRANCH: replaces the edited message's content and truncates
 * messages after it. Cleared when dataThreadId changes from the source thread
 * (the branch subscription caught up and real messages are now from the branch).
 */
export function usePendingMessages({
  threadId,
  realMessages,
}: UsePendingMessagesParams): ChatMessage[] {
  const { pendingMessage, setPendingMessage, pendingThreadId } =
    useChatLayout();

  // Derived scalars for the cleanup effect — avoids re-running on every
  // streaming update when only the message content (not the tail key) changes.
  const currentLastKey = realMessages[realMessages.length - 1]?.key;
  const hasMessages = realMessages.length > 0;

  // Clear pending message once the real message arrives
  useEffect(() => {
    if (!pendingMessage) return;

    // Edit-and-branch: clear when dataThreadId diverges from the source thread
    // (branch subscription delivered the new branch, messages are now from it)
    if (pendingMessage.editedMessageId) {
      if (threadId !== pendingMessage.threadId) {
        setPendingMessage(null);
      }
      return;
    }

    // Only clear for the primary thread — the secondary arena column must NOT
    // clear the shared pending message because its lastMessageKey comes from a
    // different thread and would never match the baseline.
    const isPrimaryThread =
      pendingMessage.threadId === threadId ||
      (threadId === undefined && pendingMessage.threadId === 'pending') ||
      (threadId === undefined &&
        pendingThreadId !== null &&
        pendingMessage.threadId === pendingThreadId);
    if (!isPrimaryThread) return;

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
    pendingThreadId,
    threadId,
    setPendingMessage,
  ]);

  return useMemo(() => {
    if (!pendingMessage) return realMessages;

    // Edit-and-branch: replace the edited message and truncate after it
    if (pendingMessage.editedMessageId) {
      if (threadId !== pendingMessage.threadId) return realMessages;

      const editIdx = realMessages.findIndex(
        (m) => m.id === pendingMessage.editedMessageId,
      );
      if (editIdx === -1) return realMessages;

      const before = realMessages.slice(0, editIdx);
      const edited: ChatMessage = {
        ...realMessages[editIdx],
        content: pendingMessage.content,
      };
      return [...before, edited];
    }

    const isPrimaryThread =
      pendingMessage.threadId === threadId ||
      (threadId === undefined && pendingMessage.threadId === 'pending') ||
      (threadId === undefined &&
        pendingThreadId !== null &&
        pendingMessage.threadId === pendingThreadId);
    const isSecondaryArenaThread =
      pendingMessage.arenaThreadIdB != null &&
      pendingMessage.arenaThreadIdB === threadId &&
      !isPrimaryThread;

    if (!isPrimaryThread && !isSecondaryArenaThread) return realMessages;

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

    // Secondary arena thread: always show optimistic until primary clears it.
    // Its lastMessageKey comes from a different thread so cannot be compared.
    if (isSecondaryArenaThread) {
      return [...realMessages, optimisticMessage];
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
  }, [threadId, realMessages, pendingMessage, pendingThreadId, currentLastKey]);
}
