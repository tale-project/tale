import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

/**
 * Mutations for an automation's inline workflow definition — the only home a
 * workflow has. Editing goes through the compare-and-swap save action; the
 * standalone-file lifecycle (install/duplicate/rename/delete) is gone with the
 * workflows config domain.
 */
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

export function useStartWorkflowFromFile() {
  return useConvexAction(api.workflow_executions.actions.startWorkflowFromFile);
}
