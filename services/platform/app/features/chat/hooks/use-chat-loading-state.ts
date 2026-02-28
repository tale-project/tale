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
 * The AI turn is considered complete (not loading) only when BOTH conditions
 * are met:
 *   1. The last message is from the assistant
 *   2. The last message has a terminal status (success/failed)
 *
 * `failed` is unconditionally terminal — even mid-tool-call — because the
 * SDK maps stream abort to `failed` (not `aborted`), and a failed generation
 * cannot resume. Without this, a failure during a tool turn would leave
 * isLoading stuck forever.
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

    const status: string | undefined = lastMessage.status;

    if (lastMessage.role !== 'assistant') return true;

    return !(status === 'success' || status === 'failed');
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
