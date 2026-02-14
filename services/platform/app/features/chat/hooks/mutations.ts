import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { api } from '@/convex/_generated/api';

export function useChatWithAgent() {
  return useConvexMutation(api.agents.chat.mutations.chatWithAgent);
}

export function useChatWithBuiltinAgent() {
  return useConvexMutation(api.agents.builtin_agents.chatWithBuiltinAgent);
}

export function useChatWithCustomAgent() {
  return useConvexMutation(api.custom_agents.chat.chatWithCustomAgent);
}

export function useSubmitHumanInputResponse() {
  return useConvexMutation(
    api.agent_tools.human_input.mutations.submitHumanInputResponse,
  );
}

export function useCreateThread() {
  return useConvexOptimisticMutation(
    api.threads.mutations.createChatThread,
    api.threads.queries.listThreads,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ title }, { insert }) =>
        insert({
          _creationTime: Date.now(),
          title,
          status: 'active',
        }),
    },
  );
}

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useDeleteThread() {
  return useConvexOptimisticMutation(
    api.threads.mutations.deleteChatThread,
    api.threads.queries.listThreads,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ threadId }, { remove }) => remove(threadId),
    },
  );
}

export function useUpdateThread() {
  return useConvexOptimisticMutation(
    api.threads.mutations.updateChatThread,
    api.threads.queries.listThreads,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ threadId, ...changes }, { update }) =>
        update(threadId, changes),
    },
  );
}
