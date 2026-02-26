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
 * Derives a single `isLoading` boolean that answers: "Is the AI turn active?"
 *
 * Rule: if the last message is NOT a terminal assistant (success/failed),
 * the AI is considered active. When no messages exist, falls back to
 * `isPending` to bridge the gap between send and first subscription data.
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
