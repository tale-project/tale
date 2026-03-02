import { useEffect, useRef } from 'react';

interface UseChatLoadingStateParams {
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
  isGenerating: boolean;
  threadId: string | undefined;
  pendingThreadId: string | null;
  terminalAssistantCount: number;
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
 * On slow networks (3G), React 18 may batch the isGenerating true→false toggle
 * into a single render, so the handoff never fires. `terminalAssistantCount`
 * acts as a backup: it's a monotonically-increasing integer that cannot be
 * coalesced away by batching.
 *
 * Safety mechanisms:
 * - Safety timeout clears `isPending` after 60s to prevent stuck states
 * - Thread mismatch clears `isPending` when navigating away from the pending
 *   thread
 * - Terminal assistant count clears `isPending` when the AI's response arrives
 *   with a terminal status (success/failed)
 */
export function useChatLoadingState({
  isPending,
  setIsPending,
  isGenerating,
  threadId,
  pendingThreadId,
  terminalAssistantCount,
}: UseChatLoadingStateParams) {
  const isLoading = isPending || isGenerating;
  const baselineRef = useRef<number | null>(null);

  // All isPending clearing logic in one effect.
  // Timeout is kept separate — merging would restart the timer on every dep change.
  useEffect(() => {
    // Capture baseline terminal count when isPending first becomes true
    if (isPending && baselineRef.current === null) {
      baselineRef.current = terminalAssistantCount;
    }

    // Handoff: clear isPending once isGenerating takes over
    if (isPending && isGenerating) {
      setIsPending(false);
    }

    // Slow-network backup: clear when a new terminal assistant message arrives
    if (
      isPending &&
      baselineRef.current !== null &&
      terminalAssistantCount > baselineRef.current
    ) {
      setIsPending(false);
    }

    // Thread mismatch: navigated away from the pending thread
    if (
      isPending &&
      pendingThreadId !== null &&
      (pendingThreadId ?? null) !== (threadId ?? null)
    ) {
      setIsPending(false);
    }

    // Reset baseline when not pending (ready for next send cycle)
    if (!isPending) {
      baselineRef.current = null;
    }
  }, [
    isPending,
    isGenerating,
    terminalAssistantCount,
    pendingThreadId,
    threadId,
    setIsPending,
  ]);

  // Safety valve: clear isPending after a max lifetime to prevent stuck states
  // (e.g. silent mutation failure, network partition).
  useEffect(() => {
    if (!isPending) return;

    const timeout = setTimeout(() => {
      setIsPending(false);
    }, SAFETY_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [isPending, setIsPending]);

  return { isLoading };
}
