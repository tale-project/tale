import { useMutation } from 'convex/react';
import { optimisticallySendMessage } from '@convex-dev/agent/react';
import type { FunctionReference } from 'convex/server';
import { api } from '@/convex/_generated/api';

// Explicit types to avoid TS2589 "Type instantiation is excessively deep" error
// when accessing deeply nested api paths
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMutation = FunctionReference<'mutation', 'public', any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = FunctionReference<'query', 'public', any, any>;

const chatWithAgentMutation: AnyMutation = api.agents.chat.mutations.chatWithAgent;
const getThreadMessagesStreamingQuery: AnyQuery = api.threads.queries.getThreadMessagesStreaming;

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
  return useMutation(chatWithAgentMutation).withOptimisticUpdate(
    (store, args) => {
      // Type assertion needed due to SDK type compatibility issue
      // The streaming query return type doesn't exactly match what optimisticallySendMessage expects
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      optimisticallySendMessage(getThreadMessagesStreamingQuery as any)(store, {
        threadId: args.threadId,
        prompt: args.message,
      });
    },
  );
}
