import { api } from '@/convex/_generated/api';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type Team = ConvexItemOf<typeof api.members.queries.getMyTeams>;

export const createTeamsCollection: CollectionFactory<Team, string> = (
  scopeId,
  queryClient,
  convexQueryFn,
) =>
  convexCollectionOptions({
    id: 'teams',
    queryFn: api.members.queries.getMyTeams,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item.id,
  });

export type { Team };
