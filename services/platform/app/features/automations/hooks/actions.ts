import { useConvexActionMutation } from '@/app/hooks/use-convex-action-mutation';
import { api } from '@/convex/_generated/api';

export function useChatWithWorkflowAssistant() {
  return useConvexActionMutation(
    api.agents.workflow.actions.chatWithWorkflowAssistant,
  );
}
