import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type Vendor = ConvexItemOf<typeof api.vendors.queries.listVendors>;

export const createVendorsCollection: CollectionFactory<Vendor, string> = (
  scopeId,
  queryClient,
  convexQueryFn,
  convexClient,
) =>
  convexCollectionOptions({
    id: 'vendors',
    queryFn: api.vendors.queries.listVendors,
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
          return convexClient.mutation(api.vendors.mutations.updateVendor, {
            vendorId: toId<'vendors'>(m.key),
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
          convexClient.mutation(api.vendors.mutations.deleteVendor, {
            vendorId: toId<'vendors'>(m.key),
          }),
        ),
      );
    },
  });

export type { Vendor };
