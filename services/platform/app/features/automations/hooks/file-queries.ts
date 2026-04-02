import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';

// ---------------------------------------------------------------------------
// Action-based hooks (filesystem reads — cached via TanStack Query,
// invalidated by SSE file events and mutation onSuccess)
// ---------------------------------------------------------------------------

type WorkflowFilter = 'installed' | 'templates' | 'all';

export function useListWorkflows(orgSlug: string, filter?: WorkflowFilter) {
  const { data, isLoading, error, refetch } = useActionQuery(
    ['config', 'workflows', orgSlug, '_list', filter],
    api.workflows.file_actions.listWorkflows,
    { orgSlug, filter },
  );
  return { workflows: data, isLoading, error, refetch };
}

export function useReadWorkflow(
  orgSlug: string,
  workflowSlug: string | undefined,
) {
  return useActionQuery(
    configKeys.detail('workflows', orgSlug, workflowSlug ?? ''),
    api.workflows.file_actions.readWorkflow,
    { orgSlug, workflowSlug: workflowSlug ?? '' },
    { enabled: !!workflowSlug },
  );
}

export function useWorkflowHistory(orgSlug: string, workflowSlug: string) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.history('workflows', orgSlug, workflowSlug),
    api.workflows.file_actions.listHistory,
    { orgSlug, workflowSlug },
  );
  return { history: data, isLoading, error, refetch };
}
