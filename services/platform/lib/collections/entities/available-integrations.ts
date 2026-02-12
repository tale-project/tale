import { api } from '@/convex/_generated/api';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type AvailableIntegration = ConvexItemOf<
  typeof api.custom_agents.queries.getAvailableIntegrations
>;

export const createAvailableIntegrationsCollection: CollectionFactory<
  AvailableIntegration,
  string
> = (scopeId, queryClient, convexQueryFn) =>
  convexCollectionOptions({
    id: 'available-integrations',
    queryFn: api.custom_agents.queries.getAvailableIntegrations,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item.name,
  });

export type { AvailableIntegration };
