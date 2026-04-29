import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useInvalidateWorkflows() {
  const queryClient = useQueryClient();
  return (organizationId: string) =>
    queryClient.invalidateQueries({
      queryKey: ['config', 'workflows', organizationId],
    });
}

export function useSaveWorkflow() {
  const invalidate = useInvalidateWorkflows();
  return useConvexAction(api.workflows.file_actions.saveWorkflowWithSnapshot, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useInstallWorkflow() {
  const invalidate = useInvalidateWorkflows();
  return useConvexAction(api.workflows.file_actions.installWorkflow, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useUninstallWorkflow() {
  const invalidate = useInvalidateWorkflows();
  return useConvexAction(api.workflows.file_actions.uninstallWorkflow, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useDeleteWorkflowFile() {
  const invalidate = useInvalidateWorkflows();
  return useConvexAction(api.workflows.file_actions.deleteWorkflow, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useDuplicateWorkflowFile() {
  const invalidate = useInvalidateWorkflows();
  return useConvexAction(api.workflows.file_actions.duplicateWorkflow, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useRenameWorkflow() {
  const invalidate = useInvalidateWorkflows();
  return useConvexAction(api.workflows.file_actions.renameWorkflow, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useRestoreFromHistory() {
  const invalidate = useInvalidateWorkflows();
  return useConvexAction(api.workflows.file_actions.restoreFromHistory, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

export function useStartWorkflowFromFile() {
  return useConvexAction(api.wf_executions.actions.startWorkflowFromFile);
}
