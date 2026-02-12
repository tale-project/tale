import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type CustomAgentVersion = ConvexItemOf<
  typeof api.custom_agents.queries.getCustomAgentVersions
>;

export const createCustomAgentVersionsCollection: CollectionFactory<
  CustomAgentVersion,
  string
> = (scopeId, queryClient, convexQueryFn) =>
  convexCollectionOptions({
    id: 'custom-agent-versions',
    queryFn: api.custom_agents.queries.getCustomAgentVersions,
    args: { customAgentId: toId<'customAgents'>(scopeId) },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
  });

export type { CustomAgentVersion };
