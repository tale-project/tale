import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

// ---------------------------------------------------------------------------
// File-based integration list (cached via TanStack Query,
// invalidated by SSE file events and mutation onSuccess)
// ---------------------------------------------------------------------------

export function useIntegrations(organizationId: string) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.list('integrations', organizationId),
    api.integrations.file_actions.listIntegrations,
    { organizationId, filter: 'all' },
    { enabled: organizationId !== '' },
  );
  return { integrations: data ?? [], isLoading, error, refetch };
}

// ---------------------------------------------------------------------------
// Reactive credential/status data from integrationCredentials table
// ---------------------------------------------------------------------------

export function useIntegrationCredentials(organizationId: string) {
  return useConvexQuery(api.integrations.credential_queries.list, {
    organizationId,
  });
}
