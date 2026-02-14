import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
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
  return useConvexOptimisticMutation(
    api.wf_definitions.mutations.publishDraft,
    api.wf_definitions.queries.listAutomations,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ wfDefinitionId }, { update }) =>
        update(wfDefinitionId, { status: 'active' }),
    },
  );
}

export function useUnpublishAutomation() {
  return useConvexOptimisticMutation(
    api.wf_definitions.mutations.unpublishWorkflow,
    api.wf_definitions.queries.listAutomations,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ wfDefinitionId }, { update }) =>
        update(wfDefinitionId, { status: 'archived' }),
    },
  );
}

export function useRepublishAutomation() {
  return useConvexOptimisticMutation(
    api.wf_definitions.mutations.republishWorkflow,
    api.wf_definitions.queries.listAutomations,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ wfDefinitionId }, { update }) =>
        update(wfDefinitionId, { status: 'active' }),
    },
  );
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
  return useConvexOptimisticMutation(
    api.wf_definitions.mutations.deleteWorkflow,
    api.wf_definitions.queries.listAutomations,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ wfDefinitionId }, { remove }) => remove(wfDefinitionId),
    },
  );
}

export function useUpdateAutomationMetadata() {
  return useConvexOptimisticMutation(
    api.wf_definitions.mutations.updateWorkflowMetadata,
    api.wf_definitions.queries.listAutomations,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ wfDefinitionId, ...changes }, { update }) =>
        update(wfDefinitionId, changes),
    },
  );
}
