import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Integration } from '@/lib/collections/entities/integrations';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useIntegrations(collection: Collection<Integration, string>) {
  const { data, isLoading } = useLiveQuery(() => collection);

  return {
    integrations: data ?? [],
    isLoading,
  };
}

export type { Integration };

export function useSsoProvider() {
  return useConvexQuery(api.sso_providers.queries.get, {});
}
