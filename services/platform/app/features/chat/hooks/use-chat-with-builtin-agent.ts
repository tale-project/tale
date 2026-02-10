import { useMutation } from 'convex/react';
import { optimisticallySendMessage } from '@convex-dev/agent/react';
import type { FunctionReference } from 'convex/server';
import { api } from '@/convex/_generated/api';

type AnyMutation = FunctionReference<'mutation', 'public', any, any>;
type AnyQuery = FunctionReference<'query', 'public', any, any>;

const chatWithBuiltinAgentMutation: AnyMutation = api.agents.builtin_agents.chatWithBuiltinAgent;
const getThreadMessagesStreamingQuery: AnyQuery = api.threads.queries.getThreadMessagesStreaming;

export function useChatWithBuiltinAgent() {
  return useMutation(chatWithBuiltinAgentMutation).withOptimisticUpdate(
    (store, args) => {
      optimisticallySendMessage(getThreadMessagesStreamingQuery as any)(store, {
        threadId: args.threadId,
        prompt: args.message,
      });
    },
  );
}
