import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useChatWithAgent() {
  return useConvexAction(api.agents.chat.actions.chatWithAgent);
}

export function useChatWithBuiltinAgent() {
  return useConvexAction(api.agents.builtin_agent_actions.chatWithBuiltinAgent);
}

export function useChatWithCustomAgent() {
  return useConvexAction(api.custom_agents.chat_actions.chatWithCustomAgent);
}

export function useSubmitHumanInputResponse() {
  return useConvexAction(
    api.agent_tools.human_input.actions.submitHumanInputResponse,
  );
}

export function useCreateThread() {
  return useConvexAction(api.threads.actions.createChatThread);
}

export function useGenerateUploadUrl() {
  return useConvexAction(api.files.actions.generateUploadUrl);
}
