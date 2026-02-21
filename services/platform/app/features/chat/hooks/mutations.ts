import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useUnifiedChatWithAgent() {
  return useConvexMutation(api.custom_agents.unified_chat.chatWithAgent);
}

export function useSubmitHumanInputResponse() {
  return useConvexMutation(
    api.agent_tools.human_input.mutations.submitHumanInputResponse,
  );
}

export function useCreateThread() {
  return useConvexMutation(api.threads.mutations.createChatThread);
}

export function useGenerateUploadUrl() {
  return useConvexMutation(api.files.mutations.generateUploadUrl);
}

export function useDeleteThread() {
  return useConvexMutation(api.threads.mutations.deleteChatThread);
}

export function useUpdateThread() {
  return useConvexMutation(api.threads.mutations.updateChatThread);
}
