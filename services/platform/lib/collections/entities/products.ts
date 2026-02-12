import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type Product = ConvexItemOf<typeof api.products.queries.listProducts>;

export const createProductsCollection: CollectionFactory<Product, string> = (
  scopeId,
  queryClient,
  convexQueryFn,
  convexClient,
) =>
  convexCollectionOptions({
    id: 'products',
    queryFn: api.products.queries.listProducts,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          const {
            _id,
            _creationTime,
            lastUpdated: _lu,
            externalId: _ext,
            ...fields
          } = m.modified;
          return convexClient.mutation(api.products.mutations.createProduct, {
            ...fields,
          });
        }),
      );
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          const {
            _id,
            _creationTime,
            organizationId: _org,
            lastUpdated: _lu,
            externalId: _ext,
            ...fields
          } = m.changes;
          return convexClient.mutation(api.products.mutations.updateProduct, {
            productId: toId<'products'>(m.key),
            ...fields,
          });
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(api.products.mutations.deleteProduct, {
            productId: toId<'products'>(m.key),
          }),
        ),
      );
    },
  });

export type { Product };
