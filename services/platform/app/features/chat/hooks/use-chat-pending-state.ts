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
 *
 * Handles the case where component remounts during navigation (e.g., first message
 * creates a new thread and navigates to /chat/[threadId]). In this case, isPending
 * is true (from context) but pendingUserCountRef is null (new component instance).
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

    const assistantMessages =
      uiMessages?.filter((m) => m.role === 'assistant') ?? [];

    // Handle component remount during navigation: isPending is true (from context)
    // but pendingUserCountRef is null (new component instance after navigation).
    // Initialize the ref so the fallback clearing logic can work.
    if (pendingUserCountRef.current === null) {
      // Use -1 as baseline so any assistant message (count >= 0) triggers clearing
      // This handles the case where we navigate to a new thread and the first
      // assistant message arrives
      pendingUserCountRef.current = assistantMessages.length - 1;
    }

    // Clear when we detect a NEW completed message
    if (assistantMessages.length > pendingUserCountRef.current) {
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
