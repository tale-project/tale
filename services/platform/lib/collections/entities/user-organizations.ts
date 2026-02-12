import { api } from '@/convex/_generated/api';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type UserOrganization = ConvexItemOf<
  typeof api.members.queries.getUserOrganizationsList
>;

export const createUserOrganizationsCollection: CollectionFactory<
  UserOrganization,
  string
> = (_scopeId, queryClient, convexQueryFn) =>
  convexCollectionOptions({
    id: 'user-organizations',
    queryFn: api.members.queries.getUserOrganizationsList,
    args: {},
    queryClient,
    convexQueryFn,
    getKey: (item) => item.organizationId,
  });

export type { UserOrganization };
