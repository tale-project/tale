import type { FunctionReference } from 'convex/server';

import { optimisticallySendMessage } from '@convex-dev/agent/react';
import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

type AnyMutation = FunctionReference<'mutation'>;
type AnyQuery = FunctionReference<'query'>;

const chatWithCustomAgentMutation: AnyMutation =
  api.custom_agents.chat.chatWithCustomAgent;
const getThreadMessagesStreamingQuery: AnyQuery =
  api.threads.queries.getThreadMessagesStreaming;

/**
 * Hook to send a message to a custom agent with optimistic updates.
 * Mirrors use-chat-with-agent.ts but targets the custom agent mutation.
 */
export function useChatWithCustomAgent() {
  return useMutation(chatWithCustomAgentMutation).withOptimisticUpdate(
    (store, args) => {
      // oxlint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-type-assertion -- SDK type mismatch: query return type doesn't match optimisticallySendMessage's expected signature
      optimisticallySendMessage(getThreadMessagesStreamingQuery as any)(store, {
        threadId: args.threadId,
        prompt: args.message,
      });
    },
  );
}
