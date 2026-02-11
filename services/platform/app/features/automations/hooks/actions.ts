import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useStartWorkflow() {
  return useConvexMutation(api.workflow_engine.mutations.startWorkflow);
}

export function useChatWithWorkflowAssistant() {
  return useConvexAction(api.agents.workflow.actions.chatWithWorkflowAssistant);
}
