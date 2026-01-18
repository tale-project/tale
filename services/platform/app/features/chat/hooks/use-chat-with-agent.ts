import { useMutation } from 'convex/react';
import { optimisticallySendMessage } from '@convex-dev/agent/react';
import { api } from '@/convex/_generated/api';

/**
 * Hook to send a message to the chat agent with optimistic updates.
 *
 * Uses the official Convex Agent SDK's optimisticallySendMessage to:
 * - Immediately show the user's message in the UI
 * - Automatically deduplicate when the server confirms the message
 * - Handle the streaming → persisted transition correctly
 *
 * Note: Our mutation uses `message` instead of `prompt`, so we adapt the args.
 */
export function useChatWithAgent() {
  return useMutation(api.chat_agent.mutations.chatWithAgent).withOptimisticUpdate(
    (store, args) => {
      // Type assertion needed due to SDK type compatibility issue
      // The streaming query return type doesn't exactly match what optimisticallySendMessage expects
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      optimisticallySendMessage(api.threads.queries.getThreadMessagesStreaming as any)(store, {
        threadId: args.threadId,
        prompt: args.message,
      });
    },
  );
}
