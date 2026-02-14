import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useStartWorkflow() {
  return useConvexMutation(api.workflow_engine.mutations.startWorkflow);
}

export function useCreateAutomation() {
  return useConvexMutation(
    api.wf_definitions.mutations.createWorkflowWithSteps,
  );
}

export function useDuplicateAutomation() {
  return useConvexMutation(api.wf_definitions.mutations.duplicateWorkflow);
}

export function usePublishAutomationDraft() {
  return useConvexMutation(api.wf_definitions.mutations.publishDraft);
}

export function useUnpublishAutomation() {
  return useConvexMutation(api.wf_definitions.mutations.unpublishWorkflow);
}

export function useRepublishAutomation() {
  return useConvexMutation(api.wf_definitions.mutations.republishWorkflow);
}

export function useCreateDraftFromActive() {
  return useConvexMutation(api.wf_definitions.mutations.createDraftFromActive);
}

export function useCreateStep() {
  return useConvexMutation(api.wf_step_defs.mutations.createStep);
}

export function useUpdateStep() {
  return useConvexMutation(api.wf_step_defs.mutations.updateStep);
}

export function useUpdateAutomation() {
  return useConvexMutation(api.wf_definitions.mutations.updateWorkflow);
}

export function useDeleteAutomation() {
  return useConvexMutation(api.wf_definitions.mutations.deleteWorkflow);
}

export function useUpdateAutomationMetadata() {
  return useConvexMutation(api.wf_definitions.mutations.updateWorkflowMetadata);
}
