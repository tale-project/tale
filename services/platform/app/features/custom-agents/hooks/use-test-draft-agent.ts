import type { FunctionReference } from 'convex/server';

import { optimisticallySendMessage } from '@convex-dev/agent/react';
import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-explicit-any -- SDK type mismatch: mutation/query types incompatible with optimisticallySendMessage expectations
type AnyMutation = FunctionReference<'mutation', 'public', any, any>;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-explicit-any -- SDK type mismatch: mutation/query types incompatible with optimisticallySendMessage expectations
type AnyQuery = FunctionReference<'query', 'public', any, any>;

const testDraftMutation: AnyMutation =
  api.custom_agents.test_chat.testDraftCustomAgent;
const getThreadMessagesStreamingQuery: AnyQuery =
  api.threads.queries.getThreadMessagesStreaming;

export function useTestDraftAgent() {
  return useMutation(testDraftMutation).withOptimisticUpdate((store, args) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-explicit-any -- SDK type mismatch: streaming query return type incompatible with optimisticallySendMessage expectations
    optimisticallySendMessage(getThreadMessagesStreamingQuery as any)(store, {
      threadId: args.threadId,
      prompt: args.message,
    });
  });
}
