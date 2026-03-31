import type { FunctionReturnType } from 'convex/server';

import { useAction } from 'convex/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

// ---------------------------------------------------------------------------
// File-based integration list (non-reactive — uses action + event refresh)
// ---------------------------------------------------------------------------

type ListIntegrationsResult = FunctionReturnType<
  typeof api.integrations.file_actions.listIntegrations
>;

export function useIntegrations(orgSlug: string) {
  const listIntegrationsFn = useAction(
    api.integrations.file_actions.listIntegrations,
  );
  const [data, setData] = useState<ListIntegrationsResult | undefined>(
    undefined,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const hasFetchedRef = useRef(false);

  const refetch = useCallback(async () => {
    if (!hasFetchedRef.current) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const result = await listIntegrationsFn({ orgSlug, filter: 'all' });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      hasFetchedRef.current = true;
      setIsLoading(false);
    }
  }, [listIntegrationsFn, orgSlug]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refetch();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refetch]);

  useEffect(() => {
    const handler = () => void refetch();
    window.addEventListener('integration-updated', handler);
    return () => window.removeEventListener('integration-updated', handler);
  }, [refetch]);

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
