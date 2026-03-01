import { useEffect } from 'react';

interface UseChatLoadingStateParams {
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
  isGenerating: boolean;
  threadId: string | undefined;
  pendingThreadId: string | null;
}

const SAFETY_TIMEOUT_MS = 60_000;

/**
 * Derives a single `isLoading` boolean that answers: "Is the AI turn active?"
 *
 * `isLoading = isPending || isGenerating`
 *
 * `isGenerating` is a reactive Convex subscription that checks whether any
 * stream for the thread is in `streaming` status. Stream status transitions
 * are atomic (unlike paginated message subscriptions which oscillate), making
 * this a reliable source of truth.
 *
 * `isPending` is a client-side optimistic flag set synchronously on send click.
 * It bridges the ~100-500ms gap until the server creates the stream and
 * `isGenerating` becomes `true`. Once `isGenerating` takes over, `isPending`
 * is cleared (handoff).
 *
 * Safety mechanisms:
 * - Safety timeout clears `isPending` after 60s to prevent stuck states
 * - Thread mismatch clears `isPending` when navigating away from the pending
 *   thread
 */
export function useChatLoadingState({
  isPending,
  setIsPending,
  isGenerating,
  threadId,
  pendingThreadId,
}: UseChatLoadingStateParams) {
  const isLoading = isPending || isGenerating;

  // Handoff: clear isPending once isGenerating takes over.
  // This prevents double-true from keeping isPending alive unnecessarily.
  useEffect(() => {
    if (isPending && isGenerating) {
      setIsPending(false);
    }
  }, [isPending, isGenerating, setIsPending]);

  // Safety valve: clear isPending after a max lifetime to prevent stuck states
  // (e.g. silent mutation failure, network partition).
  useEffect(() => {
    if (!isPending) return;

    const timeout = setTimeout(() => {
      setIsPending(false);
    }, SAFETY_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [isPending, setIsPending]);

  // Thread mismatch: navigated away from the pending thread.
  useEffect(() => {
    if (!isPending) return;

    if (
      pendingThreadId !== null &&
      (pendingThreadId ?? null) !== (threadId ?? null)
    ) {
      setIsPending(false);
    }
  }, [isPending, pendingThreadId, threadId, setIsPending]);

  return { isLoading };
}
