import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';

// ---------------------------------------------------------------------------
// Action-based hooks (filesystem reads — cached via TanStack Query,
// invalidated by SSE file events and mutation onSuccess)
// ---------------------------------------------------------------------------

type WorkflowFilter = 'installed' | 'templates' | 'all';

export function useListWorkflows(
  organizationId: string,
  filter?: WorkflowFilter,
) {
  const { data, isLoading, error, refetch } = useActionQuery(
    ['config', 'workflows', organizationId, '_list', filter],
    api.workflows.file_actions.listWorkflows,
    { organizationId, filter },
  );
  return { workflows: data, isLoading, error, refetch };
}

export function useReadWorkflow(
  organizationId: string,
  workflowSlug: string | undefined,
) {
  return useActionQuery(
    configKeys.detail('workflows', organizationId, workflowSlug ?? ''),
    api.workflows.file_actions.readWorkflow,
    { organizationId, workflowSlug: workflowSlug ?? '' },
    { enabled: !!workflowSlug },
  );
}

export function useWorkflowHistory(
  organizationId: string,
  workflowSlug: string,
) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.history('workflows', organizationId, workflowSlug),
    api.workflows.file_actions.listHistory,
    { organizationId, workflowSlug },
  );
  return { history: data, isLoading, error, refetch };
}
