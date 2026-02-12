import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type Customer = ConvexItemOf<typeof api.customers.queries.listCustomers>;

export const createCustomersCollection: CollectionFactory<Customer, string> = (
  scopeId,
  queryClient,
  convexQueryFn,
  convexClient,
) =>
  convexCollectionOptions({
    id: 'customers',
    queryFn: api.customers.queries.listCustomers,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          const {
            _id,
            _creationTime,
            organizationId: _org,
            externalId,
            ...fields
          } = m.changes;
          return convexClient.mutation(api.customers.mutations.updateCustomer, {
            customerId: toId<'customers'>(m.key),
            ...fields,
            ...(externalId !== undefined && {
              externalId: String(externalId),
            }),
          });
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(api.customers.mutations.deleteCustomer, {
            customerId: toId<'customers'>(m.key),
          }),
        ),
      );
    },
  });

export type { Customer };
