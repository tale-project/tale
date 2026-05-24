import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';

// ---------------------------------------------------------------------------
// Action-based hooks (filesystem reads — cached via TanStack Query,
// invalidated by SSE file events and mutation onSuccess)
// ---------------------------------------------------------------------------

interface QueryOptions {
  /** When false the query is paused. */
  enabled?: boolean;
}

export function useListProviders(
  organizationId: string,
  options?: QueryOptions,
) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.list('providers', organizationId),
    api.providers.file_actions.listProviders,
    { organizationId },
    options,
  );
  return { providers: data ?? [], isLoading, error, refetch };
}

export function useReadProvider(
  organizationId: string,
  providerName: string,
  options?: QueryOptions,
) {
  return useActionQuery(
    configKeys.detail('providers', organizationId, providerName),
    api.providers.file_actions.readProvider,
    { organizationId, providerName },
    options,
  );
}

export function useHasProviderSecret(
  organizationId: string,
  providerName: string,
  options?: QueryOptions,
) {
  return useActionQuery(
    ['config', 'providers', organizationId, providerName, 'secret'],
    api.providers.file_actions.hasProviderSecret,
    { organizationId, providerName },
    options,
  );
}

export function useHasModelSecret(
  organizationId: string,
  providerName: string,
  modelId: string,
  options?: QueryOptions,
) {
  return useActionQuery(
    [
      'config',
      'providers',
      organizationId,
      providerName,
      'model-secret',
      modelId,
    ],
    api.providers.file_actions.hasProviderSecret,
    { organizationId, providerName, modelId },
    options,
  );
}
