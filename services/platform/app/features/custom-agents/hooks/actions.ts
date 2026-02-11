import type { FunctionReference } from 'convex/server';

import { optimisticallySendMessage } from '@convex-dev/agent/react';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

type AnyMutation = FunctionReference<'mutation'>;
type AnyQuery = FunctionReference<'query'>;

const testMutation: AnyMutation = api.custom_agents.test_chat.testCustomAgent;
const getThreadMessagesStreamingQuery: AnyQuery =
  api.threads.queries.getThreadMessagesStreaming;

export function useTestAgent() {
  return useConvexMutation(testMutation).withOptimisticUpdate((store, args) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-explicit-any -- SDK type mismatch: streaming query return type incompatible with optimisticallySendMessage expectations
    optimisticallySendMessage(getThreadMessagesStreamingQuery as any)(store, {
      threadId: args.threadId,
      prompt: args.message,
    });
  });
}
