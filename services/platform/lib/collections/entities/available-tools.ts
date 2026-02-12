import { api } from '@/convex/_generated/api';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type AvailableTool = ConvexItemOf<
  typeof api.custom_agents.queries.getAvailableTools
>;

export const createAvailableToolsCollection: CollectionFactory<
  AvailableTool,
  string
> = (_scopeId, queryClient, convexQueryFn) =>
  convexCollectionOptions({
    id: 'available-tools',
    queryFn: api.custom_agents.queries.getAvailableTools,
    args: {},
    queryClient,
    convexQueryFn,
    getKey: (item) => item.name,
  });

export type { AvailableTool };
