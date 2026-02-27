import type { UIMessage } from '@convex-dev/agent/react';

import { useEffect, useMemo } from 'react';

interface UseChatLoadingStateParams {
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
  uiMessages: UIMessage[] | undefined;
  threadId: string | undefined;
  pendingThreadId: string | null;
}

/**
 * Checks whether the assistant message represents an in-progress tool turn
 * (the final text response has not yet arrived).
 *
 * The SDK appends parts in message order: tool-call parts first, then
 * tool-result merges into existing parts, then final text parts last.
 * If the last meaningful part is a tool-* part, the final response
 * hasn't arrived yet.
 */
function isUnfinishedToolTurn(message: UIMessage) {
  const parts = message.parts;
  if (!parts?.length) return false;

  for (let i = parts.length - 1; i >= 0; i--) {
    const type = parts[i].type;
    if (type === 'step-start' || type.startsWith('source-')) continue;
    return type.startsWith('tool-');
  }
  return false;
}

/**
 * Derives a single `isLoading` boolean that answers: "Is the AI turn active?"
 *
 * The AI turn is considered complete (not loading) only when ALL three
 * conditions are met:
 *   1. The last message is from the assistant
 *   2. The last meaningful part is not a tool part (final text has arrived)
 *   3. The last message has a terminal status (success/failed)
 *
 * When no messages exist, falls back to `isPending` to bridge the gap
 * between send and first subscription data.
 *
 * The cleanup effect clears `isPending` once loading resolves, and handles
 * thread-mismatch when the user navigates away from the pending thread.
 */
export function useChatLoadingState({
  isPending,
  setIsPending,
  uiMessages,
  threadId,
  pendingThreadId,
}: UseChatLoadingStateParams) {
  const isLoading = useMemo(() => {
    if (!uiMessages?.length) return isPending;

    const lastMessage = uiMessages[uiMessages.length - 1];

    return !(
      lastMessage.role === 'assistant' &&
      !isUnfinishedToolTurn(lastMessage) &&
      (lastMessage.status === 'success' || lastMessage.status === 'failed')
    );
  }, [isPending, uiMessages]);

  useEffect(() => {
    if (!isPending) return;

    // Thread mismatch: navigated away from the pending thread.
    // Guard: pendingThreadId !== null prevents false cleanup during
    // new-chat → new-thread transition (pendingThreadId is temporarily null).
    if (
      pendingThreadId !== null &&
      (pendingThreadId ?? null) !== (threadId ?? null)
    ) {
      setIsPending(false);
      return;
    }

    if (!isLoading) setIsPending(false);
  }, [isPending, isLoading, pendingThreadId, threadId, setIsPending]);

  return { isLoading, setIsPendingWithBaseline: setIsPending };
}
