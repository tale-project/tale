import { useMutation } from 'convex/react';
import { optimisticallySendMessage } from '@convex-dev/agent/react';
import type { FunctionReference } from 'convex/server';
import { api } from '@/convex/_generated/api';

type AnyMutation = FunctionReference<'mutation', 'public', any, any>;
type AnyQuery = FunctionReference<'query', 'public', any, any>;

const chatWithCustomAgentMutation: AnyMutation = api.custom_agents.chat.chatWithCustomAgent;
const getThreadMessagesStreamingQuery: AnyQuery = api.threads.queries.getThreadMessagesStreaming;

/**
 * Hook to send a message to a custom agent with optimistic updates.
 * Mirrors use-chat-with-agent.ts but targets the custom agent mutation.
 */
export function useChatWithCustomAgent() {
  return useMutation(chatWithCustomAgentMutation).withOptimisticUpdate(
    (store, args) => {
      optimisticallySendMessage(getThreadMessagesStreamingQuery as any)(store, {
        threadId: args.threadId,
        prompt: args.message,
      });
    },
  );
}
