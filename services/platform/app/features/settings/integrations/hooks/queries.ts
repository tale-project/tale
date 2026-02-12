import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { EmailProvider } from '@/lib/collections/entities/email-providers';
import type { Integration } from '@/lib/collections/entities/integrations';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useIntegrations(collection: Collection<Integration, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q
      .from({ integration: collection })
      .select(({ integration }) => integration),
  );

  return {
    integrations: data,
    isLoading,
  };
}

export function useEmailProviders(
  collection: Collection<EmailProvider, string>,
) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ provider: collection }).select(({ provider }) => provider),
  );

  return {
    providers: data,
    isLoading,
  };
}

export type { EmailProvider, Integration };

export function useSsoProvider() {
  return useConvexQuery(api.sso_providers.queries.get, {});
}
