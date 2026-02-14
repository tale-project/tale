import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export type Integration = ConvexItemOf<typeof api.integrations.queries.list>;

export function useIntegrations(organizationId: string) {
  const { data, isLoading } = useConvexQuery(api.integrations.queries.list, {
    organizationId,
  });

  return {
    integrations: data ?? [],
    isLoading,
  };
}

export function useSsoProvider() {
  return useConvexQuery(api.sso_providers.queries.get, {});
}
