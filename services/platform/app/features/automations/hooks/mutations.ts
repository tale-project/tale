import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { WfAutomation } from '@/lib/collections/entities/wf-automations';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useUpdateStep() {
  return useConvexMutation(api.wf_step_defs.mutations.updateStep);
}

export function useCreateStep() {
  return useConvexMutation(api.wf_step_defs.mutations.createStep);
}

export function useUpdateAutomation() {
  return useConvexMutation(api.wf_definitions.mutations.updateWorkflow);
}

export function useCreateAutomation() {
  return useConvexMutation(
    api.wf_definitions.mutations.createWorkflowWithSteps,
  );
}

export function useDeleteAutomation(
  collection: Collection<WfAutomation, string>,
) {
  return useCallback(
    async (args: { wfDefinitionId: string }) => {
      const tx = collection.delete(args.wfDefinitionId);
      await tx.isPersisted.promise;
    },
    [collection],
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

export function useUpdateAutomationMetadata() {
  return useConvexMutation(api.wf_definitions.mutations.updateWorkflowMetadata);
}

export function useCreateDraftFromActive() {
  return useConvexMutation(api.wf_definitions.mutations.createDraftFromActive);
}
