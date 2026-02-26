import type { UIMessage } from '@convex-dev/agent/react';

import { useEffect, useMemo, useRef } from 'react';

interface UseChatPendingStateParams {
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
  uiMessages: UIMessage[] | undefined;
}

/**
 * Hook to manage pending state clearing.
 *
 * Provides `effectivePending` — a synchronously derived value that determines
 * whether a pending send is still in-flight. This eliminates the one-frame gap
 * between the ThinkingAnimation disappearing (synchronous useMemo) and the
 * context `isPending` being cleared (asynchronous useEffect).
 *
 * Also handles component remount during navigation (e.g., first message
 * creates a new thread and navigates to /chat/[threadId]).
 */
export function useChatPendingState({
  isPending,
  setIsPending,
  uiMessages,
}: UseChatPendingStateParams) {
  const assistantCountRef = useRef<number | null>(null);

  const setPendingWithCount = (
    pending: boolean,
    _isHumanInputResponse = false,
  ) => {
    if (pending) {
      const currentCount =
        uiMessages?.filter((m) => m.role === 'assistant').length ?? 0;
      assistantCountRef.current = currentCount;
    }
    setIsPending(pending);
  };

  // Synchronous derivation of the effective pending state.
  // Uses the same logic that the effect would use, but computed during render
  // so isLoading updates in the same frame as hasIncompleteAssistantMessage.
  const effectivePending = useMemo(() => {
    if (!isPending) return false;
    if (!uiMessages?.length) return true;

    const assistantMessages = uiMessages.filter((m) => m.role === 'assistant');
    const baseline =
      assistantCountRef.current ?? Math.max(0, assistantMessages.length - 1);

    // No new assistant message yet — keep pending (covers the send → message gap)
    if (assistantMessages.length <= baseline) return true;

    // New assistant message exists — still pending only while non-terminal
    return assistantMessages.some(
      (m) => m.status !== 'success' && m.status !== 'failed',
    );
  }, [isPending, uiMessages]);

  // Sync context state when the derivation determines pending is done.
  // This is the only purpose of the effect — the derivation above is the
  // single source of truth for consumers.
  useEffect(() => {
    if (isPending && !effectivePending) {
      setIsPending(false);
      assistantCountRef.current = null;
    }
    if (!isPending) {
      assistantCountRef.current = null;
    }
  }, [isPending, effectivePending, setIsPending]);

  return { setPendingWithCount, effectivePending };
}
