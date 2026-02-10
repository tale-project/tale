import type { FunctionReference } from 'convex/server';

import { optimisticallySendMessage } from '@convex-dev/agent/react';
import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

type AnyMutation = FunctionReference<'mutation'>;
type AnyQuery = FunctionReference<'query'>;

const chatWithBuiltinAgentMutation: AnyMutation =
  api.agents.builtin_agents.chatWithBuiltinAgent;
const getThreadMessagesStreamingQuery: AnyQuery =
  api.threads.queries.getThreadMessagesStreaming;

export function useChatWithBuiltinAgent() {
  return useMutation(chatWithBuiltinAgentMutation).withOptimisticUpdate(
    (store, args) => {
      // oxlint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-type-assertion -- SDK type mismatch: query return type doesn't match optimisticallySendMessage's expected signature
      optimisticallySendMessage(getThreadMessagesStreamingQuery as any)(store, {
        threadId: args.threadId,
        prompt: args.message,
      });
    },
  );
}
