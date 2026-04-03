import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';

// ---------------------------------------------------------------------------
// Action-based hooks (filesystem reads — cached via TanStack Query,
// invalidated by SSE file events and mutation onSuccess)
// ---------------------------------------------------------------------------

export function useListProviders(orgSlug: string) {
  const { data, isLoading, error, refetch } = useActionQuery(
    configKeys.list('providers', orgSlug),
    api.providers.file_actions.listProviders,
    { orgSlug },
  );
  return { providers: data ?? [], isLoading, error, refetch };
}

export function useReadProvider(orgSlug: string, providerName: string) {
  return useActionQuery(
    configKeys.detail('providers', orgSlug, providerName),
    api.providers.file_actions.readProvider,
    { orgSlug, providerName },
  );
}

export function useHasProviderSecret(orgSlug: string, providerName: string) {
  return useActionQuery(
    ['config', 'providers', orgSlug, providerName, 'secret'],
    api.providers.file_actions.hasProviderSecret,
    { orgSlug, providerName },
  );
}
