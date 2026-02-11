import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type EmailProvider = ConvexItemOf<typeof api.email_providers.queries.list>;

export const createEmailProvidersCollection: CollectionFactory<
  EmailProvider,
  string
> = (scopeId, queryClient, convexQueryFn, convexClient) =>
  convexCollectionOptions({
    id: 'email-providers',
    queryFn: api.email_providers.queries.list,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(api.email_providers.mutations.updateProvider, {
            providerId: toId<'emailProviders'>(m.key),
            name: m.modified.name,
          }),
        ),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(api.email_providers.mutations.deleteProvider, {
            providerId: toId<'emailProviders'>(m.key),
          }),
        ),
      );
    },
  });

export type { EmailProvider };
