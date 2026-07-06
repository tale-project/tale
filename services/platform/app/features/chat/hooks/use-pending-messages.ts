import { useMemo, useEffect, useRef } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { useChatLayout } from '../context/chat-layout-context';
import type { FileAttachment } from '../types';
import {
  anchorBubbleExistsInMessages,
  computeStreamingAssistantAboveLastUser,
  createOptimisticAssistantShell,
  findLastUserIndex,
  hasRealAssistantRowAfterLastUser,
  hasVisibleAssistantAfterLastUser,
  shouldSuppressOptimisticShell,
} from '../utils/pending-shell-utils';
import type { ChatMessage } from './use-message-processing';

interface UsePendingMessagesParams {
  threadId: string | undefined;
  realMessages: ChatMessage[];
  /** Optimistic send/resume flag — keeps the assistant shell after the pending
   *  user clears until a visible assistant row lands. */
  isSendPending?: boolean;
  /** Server-confirmed generation in flight (post `clearSendPending`). Keeps the
   *  shell + stable bubble key until a renderable assistant replaces it. */
  isAgentActivelyWorking?: boolean;
  /** External-agent live segment id — suppresses a duplicate shell below when
   *  the anchor bubble is already in the list. */
  liveAssistantMessageId?: string | null;
  /** Edit-and-branch swap hold — suppress orphan thinking during branch load. */
  suppressOptimisticShell?: boolean;
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
 *
 * Optimistic assistant shell: appended in the same commit as the pending user
 * (or alone on human-input resume via `isSendPending`) and cleared only once a
 * **visible** post-user assistant replaces it — not on raw subscription tail.
 *
 * When the server row arrives (even empty/streaming), the shell **promotes** it:
 * one bubble, stable `key`, same ThinkingIndicator instance through handoff.
 */
function computeIsPrimaryThread(
  messageThreadId: string,
  threadId: string | undefined,
  pendingThreadId: string | null,
): boolean {
  return (
    messageThreadId === threadId ||
    (threadId === undefined && messageThreadId === 'pending') ||
    (threadId === undefined &&
      pendingThreadId !== null &&
      messageThreadId === pendingThreadId)
  );
}

function stripOptimisticShell(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(
    (m) => !(m.isOptimisticShell && m.id.startsWith('pending-assistant-')),
  );
}

function clearShellPromotion(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    m.isOptimisticShell ? { ...m, isOptimisticShell: undefined } : m,
  );
}

/** Adopt the server assistant row into the shell slot (stable key, no duplicate). */
function promoteAssistantWithShellIdentity(
  messages: ChatMessage[],
  shell: ChatMessage,
): ChatMessage[] {
  const withoutPlaceholder = stripOptimisticShell(messages);
  const lastUserIdx = findLastUserIndex(withoutPlaceholder);
  for (let i = lastUserIdx + 1; i < withoutPlaceholder.length; i++) {
    const m = withoutPlaceholder[i];
    if (m.role !== 'assistant') continue;
    return [
      ...withoutPlaceholder.slice(0, i),
      { ...m, key: shell.key, isOptimisticShell: true },
      ...withoutPlaceholder.slice(i + 1),
    ];
  }
  return [...withoutPlaceholder, shell];
}

export function usePendingMessages({
  threadId,
  realMessages,
  isSendPending = false,
  isAgentActivelyWorking = false,
  liveAssistantMessageId,
  suppressOptimisticShell = false,
}: UsePendingMessagesParams): ChatMessage[] {
  const { pendingMessage, setPendingMessage, pendingThreadId } =
    useChatLayout();

  const shellRef = useRef<{
    threadId: string | undefined;
    shell: ChatMessage;
    /** Assistant ids present when the shell was created. Rows NOT in here are
     *  this turn's answer — content makes them visible even while the
     *  optimistic `isSendPending` flag lingers (a fast model can complete the
     *  whole turn before the client ever sees isGenerating=true). */
    baselineAssistantIds: ReadonlySet<string>;
  }>(null);
  const shellThreadRef = useRef(threadId);

  // Render-time thread reset — same commit as slack gating (no one-frame bleed).
  if (shellThreadRef.current !== threadId) {
    shellThreadRef.current = threadId;
    shellRef.current = null;
  }

  // Derived scalars for the cleanup effect — avoids re-running on every
  // streaming update when only the message content (not the tail key) changes.
  const currentLastKey = realMessages[realMessages.length - 1]?.key;
  const hasMessages = realMessages.length > 0;

  // Clear pending message once the real message arrives
  useEffect(() => {
    if (!pendingMessage) return;

    // Arena: each column manages its own lifecycle via local state (props-based).
    // Don't clear the shared pendingMessage from individual column effects.
    if (pendingMessage.arenaThreadIdB) return;

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
    const isPrimaryThread = computeIsPrimaryThread(
      pendingMessage.threadId,
      threadId,
      pendingThreadId,
    );
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
    let merged: ChatMessage[];
    let showPendingUser = false;

    if (!pendingMessage) {
      merged = realMessages;
    } else if (pendingMessage.editedMessageId) {
      if (threadId !== pendingMessage.threadId) {
        merged = realMessages;
      } else {
        const editIdx = realMessages.findIndex(
          (m) => m.id === pendingMessage.editedMessageId,
        );
        if (editIdx === -1) {
          merged = realMessages;
        } else {
          const before = realMessages.slice(0, editIdx);
          const edited: ChatMessage = {
            ...realMessages[editIdx],
            content: pendingMessage.content,
          };
          merged = [...before, edited];
        }
      }
    } else {
      const isPrimaryThread = computeIsPrimaryThread(
        pendingMessage.threadId,
        threadId,
        pendingThreadId,
      );
      const isSecondaryArenaThread =
        pendingMessage.arenaThreadIdB != null &&
        pendingMessage.arenaThreadIdB === threadId &&
        !isPrimaryThread;

      if (!isPrimaryThread && !isSecondaryArenaThread) {
        merged = realMessages;
      } else {
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
          merged = [optimisticMessage];
          showPendingUser = true;
        } else if (isSecondaryArenaThread) {
          merged = [...realMessages, optimisticMessage];
          showPendingUser = true;
        } else if (
          pendingMessage.lastMessageKey !== undefined &&
          currentLastKey === pendingMessage.lastMessageKey
        ) {
          merged = [...realMessages, optimisticMessage];
          showPendingUser = true;
        } else {
          merged = realMessages;
        }
      }
    }

    // --- Optimistic assistant shell (in-bubble Thinking) ---
    const turnInFlight = isSendPending || isAgentActivelyWorking;
    const turnActive = turnInFlight || showPendingUser;
    const isEditBranchPending = !!pendingMessage?.editedMessageId;

    if (suppressOptimisticShell || isEditBranchPending || !turnActive) {
      shellRef.current = null;
      return clearShellPromotion(stripOptimisticShell(merged));
    }

    // Shell hidden but the turn is still in flight: KEEP shellRef. Nulling it
    // here re-created the shell with a fresh `new Date()` key if visibility
    // flipped back (streaming row completing under a lingering isSendPending)
    // — a full bubble remount observed as the end-of-turn Thinking flash.
    if (
      hasVisibleAssistantAfterLastUser(
        merged,
        turnInFlight,
        shellRef.current?.baselineAssistantIds,
      )
    ) {
      return clearShellPromotion(stripOptimisticShell(merged));
    }

    const streamingAbove = computeStreamingAssistantAboveLastUser(merged);
    const anchorExists = anchorBubbleExistsInMessages(
      merged,
      liveAssistantMessageId,
    );
    if (
      shouldSuppressOptimisticShell({
        streamingAssistantAboveLastUser: streamingAbove,
        liveAssistantMessageId,
        anchorBubbleExists: anchorExists,
      })
    ) {
      return clearShellPromotion(stripOptimisticShell(merged));
    }

    const shellTimestamp =
      pendingMessage?.timestamp ??
      shellRef.current?.shell.timestamp ??
      new Date();
    // Recreate on thread switch or a NEW send (fresh pending timestamp) —
    // shellRef now survives the visible/suppressed paths, so without the
    // timestamp check a later turn would reuse the previous turn's shell key
    // and collide with the key latched onto that turn's answer bubble.
    if (
      !shellRef.current ||
      shellRef.current.threadId !== threadId ||
      shellRef.current.shell.timestamp.getTime() !== shellTimestamp.getTime()
    ) {
      shellRef.current = {
        threadId,
        shell: createOptimisticAssistantShell(shellTimestamp),
        baselineAssistantIds: new Set(
          merged.filter((m) => m.role === 'assistant').map((m) => m.id),
        ),
      };
    }

    const shell = shellRef.current.shell;
    const base = stripOptimisticShell(merged);

    // Server row landed (even empty/streaming): promote into the shell slot —
    // one bubble, stable key, no shell+real duplicate remount.
    if (hasRealAssistantRowAfterLastUser(base)) {
      return promoteAssistantWithShellIdentity(base, shell);
    }

    return [...base, shell];
  }, [
    threadId,
    realMessages,
    pendingMessage,
    pendingThreadId,
    currentLastKey,
    isSendPending,
    isAgentActivelyWorking,
    liveAssistantMessageId,
    suppressOptimisticShell,
  ]);
}
