import type { FunctionReference } from 'convex/server';

import { optimisticallySendMessage } from '@convex-dev/agent/react';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

type AnyMutation = FunctionReference<'mutation'>;
type AnyQuery = FunctionReference<'query'>;

const chatWithAgentMutation: AnyMutation =
  api.agents.chat.mutations.chatWithAgent;
const chatWithBuiltinAgentMutation: AnyMutation =
  api.agents.builtin_agents.chatWithBuiltinAgent;
const chatWithCustomAgentMutation: AnyMutation =
  api.custom_agents.chat.chatWithCustomAgent;
const getThreadMessagesStreamingQuery: AnyQuery =
  api.threads.queries.getThreadMessagesStreaming;

/**
 * Hook to send a message to the chat agent with optimistic updates.
 *
 * Uses the official Convex Agent SDK's optimisticallySendMessage to:
 * - Immediately show the user's message in the UI
 * - Automatically deduplicate when the server confirms the message
 * - Handle the streaming -> persisted transition correctly
 *
 * Note: Our mutation uses `message` instead of `prompt`, so we adapt the args.
 */
export function useChatWithAgent() {
  return useConvexMutation(chatWithAgentMutation).withOptimisticUpdate(
    (store, args) => {
      // oxlint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-type-assertion -- SDK type mismatch: query return type doesn't match optimisticallySendMessage's expected signature
      optimisticallySendMessage(getThreadMessagesStreamingQuery as any)(store, {
        threadId: args.threadId,
        prompt: args.message,
      });
    },
  );
}

export function useChatWithBuiltinAgent() {
  return useConvexMutation(chatWithBuiltinAgentMutation).withOptimisticUpdate(
    (store, args) => {
      // oxlint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-type-assertion -- SDK type mismatch: query return type doesn't match optimisticallySendMessage's expected signature
      optimisticallySendMessage(getThreadMessagesStreamingQuery as any)(store, {
        threadId: args.threadId,
        prompt: args.message,
      });
    },
  );
}

/**
 * Hook to send a message to a custom agent with optimistic updates.
 * Mirrors useChatWithAgent but targets the custom agent mutation.
 */
export function useChatWithCustomAgent() {
  return useConvexMutation(chatWithCustomAgentMutation).withOptimisticUpdate(
    (store, args) => {
      // oxlint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-type-assertion -- SDK type mismatch: query return type doesn't match optimisticallySendMessage's expected signature
      optimisticallySendMessage(getThreadMessagesStreamingQuery as any)(store, {
        threadId: args.threadId,
        prompt: args.message,
      });
    },
  );
}

export function useSubmitHumanInputResponse() {
  return useConvexMutation(
    api.agent_tools.human_input.mutations.submitHumanInputResponse,
  );
}
