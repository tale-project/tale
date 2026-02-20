import type { UIMessage } from '@convex-dev/agent/react';

import { useEffect, useRef } from 'react';

interface UseChatPendingStateParams {
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
  uiMessages: UIMessage[] | undefined;
}

/**
 * Hook to manage pending state clearing.
 * Clears pending only when no assistant messages are in a non-terminal state.
 * This ensures loading stays visible throughout the entire AI processing lifecycle,
 * including gaps between tool calls and status transitions.
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

  useEffect(() => {
    if (!isPending) {
      assistantCountRef.current = null;
      return;
    }

    if (!uiMessages?.length) return;

    const assistantMessages = uiMessages.filter((m) => m.role === 'assistant');

    // Initialize on first run (handles component remount during navigation)
    if (assistantCountRef.current === null) {
      assistantCountRef.current = Math.max(0, assistantMessages.length - 1);
    }

    // Wait for a new assistant message to appear before checking terminal status
    if (assistantMessages.length <= assistantCountRef.current) return;

    // Clear only when no assistant messages are in a non-terminal state
    const hasNonTerminal = assistantMessages.some(
      (m) => m.status !== 'success' && m.status !== 'failed',
    );

    if (!hasNonTerminal) {
      setIsPending(false);
      assistantCountRef.current = null;
    }
  }, [isPending, setIsPending, uiMessages]);

  return { setPendingWithCount };
}
