import type { UIMessage } from '@convex-dev/agent/react';

import { useEffect, useMemo, useRef } from 'react';

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
 * Two phases:
 *  1. **Active assistant** — any assistant message has a non-terminal status
 *     (streaming, pending, or undefined). This is the primary signal and does
 *     not depend on `isPending`.
 *  2. **Send-gap bridge** — the user has sent a message (`isPending`) but no
 *     new assistant message has appeared yet. Uses a ref-based assistant-count
 *     baseline captured at send time to distinguish "new" from "pre-existing".
 *
 * Also handles the context `isPending` cleanup: once `isLoading` resolves to
 * false, the effect clears `isPending` so subsequent sends start clean.
 */
export function useChatLoadingState({
  isPending,
  setIsPending,
  uiMessages,
  threadId,
  pendingThreadId,
}: UseChatLoadingStateParams) {
  const assistantCountAtSendRef = useRef<number | null>(null);

  const setIsPendingWithBaseline = (pending: boolean) => {
    if (pending) {
      assistantCountAtSendRef.current =
        uiMessages?.filter((m) => m.role === 'assistant').length ?? 0;
    }
    setIsPending(pending);
  };

  const isLoading = useMemo(() => {
    // Phase 1: Any non-terminal assistant message = AI is actively working.
    // Uses !== 'success'/'failed' so undefined status is treated as active.
    if (
      uiMessages?.some(
        (m) =>
          m.role === 'assistant' &&
          m.status !== 'success' &&
          m.status !== 'failed',
      )
    )
      return true;

    // Phase 2: Pending bridge — covers the gap between send and first response.
    if (!isPending) return false;
    if ((pendingThreadId ?? null) !== (threadId ?? null)) return false;
    if (!uiMessages?.length) return true;

    const assistantCount = uiMessages.filter(
      (m) => m.role === 'assistant',
    ).length;
    const baseline =
      assistantCountAtSendRef.current ?? Math.max(0, assistantCount - 1);

    // No new assistant message has appeared since the send
    return assistantCount <= baseline;
  }, [isPending, pendingThreadId, threadId, uiMessages]);

  // Sync context state: clear isPending once loading resolves.
  useEffect(() => {
    if (isPending && !isLoading) {
      setIsPending(false);
      assistantCountAtSendRef.current = null;
    }
    if (!isPending) {
      assistantCountAtSendRef.current = null;
    }
  }, [isPending, isLoading, setIsPending]);

  return { isLoading, setIsPendingWithBaseline };
}
