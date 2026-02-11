import { api } from '@/convex/_generated/api';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type AutomationRoot = ConvexItemOf<
  typeof api.wf_definitions.queries.listAutomationRoots
>;

export const createAutomationRootsCollection: CollectionFactory<
  AutomationRoot,
  string
> = (scopeId, queryClient, convexQueryFn) =>
  convexCollectionOptions({
    id: 'automation-roots',
    queryFn: api.wf_definitions.queries.listAutomationRoots,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
  });

export type { AutomationRoot };
