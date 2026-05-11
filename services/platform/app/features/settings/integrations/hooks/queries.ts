import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

// ---------------------------------------------------------------------------
// File-based integration list (cached via TanStack Query,
// invalidated by SSE file events and mutation onSuccess)
// ---------------------------------------------------------------------------

export function useIntegrations(orgSlug: string) {
  // Skip the action while the caller is still resolving the org's slug
  // (e.g. /dashboard/$id/settings/integrations on first render before
  // useOrganization resolves). Firing with orgSlug='' would throw
  // "Invalid org slug:" on the server — noise only, but pollutes logs.
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.list('integrations', orgSlug),
    api.integrations.file_actions.listIntegrations,
    { orgSlug, filter: 'all' },
    { enabled: orgSlug !== '' },
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

// ---------------------------------------------------------------------------
// SSO (unchanged)
// ---------------------------------------------------------------------------

export function useSsoProvider() {
  return useConvexQuery(api.sso_providers.queries.get, {});
}
