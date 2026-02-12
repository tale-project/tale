import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useStartWorkflow() {
  return useConvexAction(api.workflow_engine.actions.startWorkflow);
}

export function useChatWithWorkflowAssistant() {
  return useConvexAction(api.agents.workflow.actions.chatWithWorkflowAssistant);
}

export function useCreateStep() {
  return useConvexAction(api.wf_step_defs.actions.createStep);
}

export function useCreateAutomation() {
  return useConvexAction(api.wf_definitions.actions.createWorkflowWithSteps);
}

export function useDuplicateAutomation() {
  return useConvexAction(api.wf_definitions.actions.duplicateWorkflow);
}

export function usePublishAutomationDraft() {
  return useConvexAction(api.wf_definitions.actions.publishDraft);
}

export function useUnpublishAutomation() {
  return useConvexAction(api.wf_definitions.actions.unpublishWorkflow);
}

export function useRepublishAutomation() {
  return useConvexAction(api.wf_definitions.actions.republishWorkflow);
}

export function useCreateDraftFromActive() {
  return useConvexAction(api.wf_definitions.actions.createDraftFromActive);
}
