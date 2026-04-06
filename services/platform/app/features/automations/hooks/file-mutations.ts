import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

function useInvalidateWorkflows() {
  const queryClient = useQueryClient();
  return (orgSlug: string) =>
    queryClient.invalidateQueries({
      queryKey: ['config', 'workflows', orgSlug],
    });
}

export function useSaveWorkflow() {
  const invalidate = useInvalidateWorkflows();
  return useConvexAction(api.workflows.file_actions.saveWorkflowWithSnapshot, {
    onSuccess: (_data, variables) => invalidate(variables.orgSlug),
  });
}

export function useInstallWorkflow() {
  const invalidate = useInvalidateWorkflows();
  return useConvexAction(api.workflows.file_actions.installWorkflow, {
    onSuccess: (_data, variables) => invalidate(variables.orgSlug),
  });
}

export function useToggleWorkflowEnabled() {
  const readAction = useConvexAction(api.workflows.file_actions.readWorkflow);
  const saveAction = useConvexAction(
    api.workflows.file_actions.saveWorkflowWithSnapshot,
  );
  const invalidate = useInvalidateWorkflows();

  return {
    mutate: async (args: { orgSlug: string; workflowSlug: string }) => {
      const result = await readAction.mutateAsync(args);
      if (!result.ok) {
        throw new Error(`Cannot read workflow: ${result.message}`);
      }
      const updatedConfig = {
        ...result.config,
        enabled: !result.config.enabled,
      };
      const saveResult = await saveAction.mutateAsync({
        orgSlug: args.orgSlug,
        workflowSlug: args.workflowSlug,
        config: updatedConfig,
        expectedHash: result.hash,
      });
      void invalidate(args.orgSlug);
      return saveResult;
    },
    isPending: readAction.isPending || saveAction.isPending,
  };
}

export function useDeleteWorkflowFile() {
  const invalidate = useInvalidateWorkflows();
  return useConvexAction(api.workflows.file_actions.deleteWorkflow, {
    onSuccess: (_data, variables) => invalidate(variables.orgSlug),
  });
}

export function useDuplicateWorkflowFile() {
  const invalidate = useInvalidateWorkflows();
  return useConvexAction(api.workflows.file_actions.duplicateWorkflow, {
    onSuccess: (_data, variables) => invalidate(variables.orgSlug),
  });
}

export function useRenameWorkflow() {
  const invalidate = useInvalidateWorkflows();
  return useConvexAction(api.workflows.file_actions.renameWorkflow, {
    onSuccess: (_data, variables) => invalidate(variables.orgSlug),
  });
}

export function useRestoreFromHistory() {
  const invalidate = useInvalidateWorkflows();
  return useConvexAction(api.workflows.file_actions.restoreFromHistory, {
    onSuccess: (_data, variables) => invalidate(variables.orgSlug),
  });
}

export function useStartWorkflowFromFile() {
  return useConvexAction(api.wf_executions.actions.startWorkflowFromFile);
}
