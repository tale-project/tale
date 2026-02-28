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
 * Pure synchronous derivation — no async state, no debounce. Scans ALL
 * messages (not just the last) so that a non-terminal assistant message
 * anywhere in the list keeps loading true.
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

    // If ANY assistant message is still active, the turn isn't done
    if (
      uiMessages.some(
        (m) =>
          m.role === 'assistant' &&
          m.status !== 'success' &&
          m.status !== 'failed',
      )
    )
      return true;

    const lastMessage = uiMessages[uiMessages.length - 1];

    if (lastMessage.role !== 'assistant') return true;

    const status: string | undefined = lastMessage.status;
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
