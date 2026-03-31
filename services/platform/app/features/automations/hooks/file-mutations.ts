import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useSaveWorkflow() {
  return useConvexAction(api.workflows.file_actions.saveWorkflowWithSnapshot);
}

export function useInstallWorkflow() {
  return useConvexAction(api.workflows.file_actions.installWorkflow);
}

export function useToggleWorkflowEnabled() {
  const readAction = useConvexAction(api.workflows.file_actions.readWorkflow);
  const saveAction = useConvexAction(
    api.workflows.file_actions.saveWorkflowWithSnapshot,
  );

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
      return saveAction.mutateAsync({
        orgSlug: args.orgSlug,
        workflowSlug: args.workflowSlug,
        config: updatedConfig,
        expectedHash: result.hash,
      });
    },
    isPending: readAction.isPending || saveAction.isPending,
  };
}

export function useDeleteWorkflowFile() {
  return useConvexAction(api.workflows.file_actions.deleteWorkflow);
}

export function useDuplicateWorkflowFile() {
  return useConvexAction(api.workflows.file_actions.duplicateWorkflow);
}

export function useRenameWorkflow() {
  return useConvexAction(api.workflows.file_actions.renameWorkflow);
}

export function useRestoreFromHistory() {
  return useConvexAction(api.workflows.file_actions.restoreFromHistory);
}

export function useStartWorkflowFromFile() {
  return useConvexAction(api.wf_executions.actions.startWorkflowFromFile);
}
