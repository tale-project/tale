import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type Integration = ConvexItemOf<typeof api.integrations.queries.list>;

export const createIntegrationsCollection: CollectionFactory<
  Integration,
  string
> = (scopeId, queryClient, convexQueryFn, convexClient) =>
  convexCollectionOptions({
    id: 'integrations',
    queryFn: api.integrations.queries.list,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(api.integrations.mutations.deleteIntegration, {
            integrationId: toId<'integrations'>(m.key),
          }),
        ),
      );
    },
  });

export type { Integration };
