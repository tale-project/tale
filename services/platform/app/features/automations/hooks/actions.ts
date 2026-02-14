import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useChatWithWorkflowAssistant() {
  return useConvexAction(api.agents.workflow.actions.chatWithWorkflowAssistant);
}
