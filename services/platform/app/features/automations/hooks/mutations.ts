import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { api } from '@/convex/_generated/api';

export function useStartWorkflow() {
  return useConvexMutation(api.workflow_engine.mutations.startWorkflow);
}

export function useCreateAutomation() {
  return useConvexMutation(
    api.wf_definitions.mutations.createWorkflowWithSteps,
    {
      invalidates: [
        api.wf_definitions.queries.listAutomations,
        api.wf_definitions.queries.listAutomationRoots,
      ],
    },
  );
}

export function useDuplicateAutomation() {
  return useConvexMutation(api.wf_definitions.mutations.duplicateWorkflow, {
    invalidates: [
      api.wf_definitions.queries.listAutomations,
      api.wf_definitions.queries.listAutomationRoots,
    ],
  });
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
  return useConvexMutation(api.wf_definitions.mutations.createDraftFromActive, {
    invalidates: [api.wf_definitions.queries.listAutomations],
  });
}

export function useCreateStep() {
  return useConvexMutation(api.wf_step_defs.mutations.createStep, {
    invalidates: [api.wf_step_defs.queries.getWorkflowSteps],
  });
}

export function useUpdateStep() {
  return useConvexMutation(api.wf_step_defs.mutations.updateStep, {
    invalidates: [api.wf_step_defs.queries.getWorkflowSteps],
  });
}

export function useUpdateAutomation() {
  return useConvexMutation(api.wf_definitions.mutations.updateWorkflow, {
    invalidates: [api.wf_definitions.queries.listAutomations],
  });
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
