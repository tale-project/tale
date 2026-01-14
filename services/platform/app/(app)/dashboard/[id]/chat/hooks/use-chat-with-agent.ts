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
  return useMutation(api.chat_agent.chatWithAgent).withOptimisticUpdate(
    (store, args) => {
      // Adapt our args format (message) to SDK's expected format (prompt)
      optimisticallySendMessage(api.threads.getThreadMessagesStreaming)(store, {
        threadId: args.threadId,
        prompt: args.message,
      });
    },
  );
}
