import { useEffect, useRef } from 'react';
import type { UIMessage } from '@convex-dev/agent/react';

interface UseChatPendingStateParams {
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
  streamingMessage: UIMessage | undefined;
  uiMessages: UIMessage[] | undefined;
}

/**
 * Hook to manage pending state clearing.
 * Clears pending when streaming starts or when a completed message appears.
 */
export function useChatPendingState({
  isPending,
  setIsPending,
  streamingMessage,
  uiMessages,
}: UseChatPendingStateParams) {
  const pendingUserCountRef = useRef<number | null>(null);

  // Set the pending count when isPending becomes true
  const setPendingWithCount = (pending: boolean) => {
    if (pending) {
      const currentAssistantCount =
        uiMessages?.filter((m) => m.role === 'assistant').length ?? 0;
      pendingUserCountRef.current = currentAssistantCount;
    }
    setIsPending(pending);
  };

  // Clear pending state when streaming starts OR when a completed message appears
  useEffect(() => {
    if (!isPending) {
      pendingUserCountRef.current = null;
      return;
    }

    // Clear when streaming actually starts
    if (streamingMessage) {
      setIsPending(false);
      pendingUserCountRef.current = null;
      return;
    }

    // Also clear when we detect a NEW completed message
    const assistantMessages =
      uiMessages?.filter((m) => m.role === 'assistant') ?? [];

    if (
      pendingUserCountRef.current !== null &&
      assistantMessages.length > pendingUserCountRef.current
    ) {
      const lastAssistantMessage = assistantMessages.at(-1);
      if (
        lastAssistantMessage &&
        lastAssistantMessage.status !== 'streaming' &&
        lastAssistantMessage.text
      ) {
        setIsPending(false);
        pendingUserCountRef.current = null;
      }
    }
  }, [streamingMessage, isPending, setIsPending, uiMessages]);

  return { setPendingWithCount, pendingUserCountRef };
}
