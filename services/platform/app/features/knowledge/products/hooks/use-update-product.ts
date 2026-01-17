import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateProduct(organizationId: string) {
  return useMutation(api.products.updateProduct).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.products.getAllProducts, {
        organizationId,
      });

      if (current !== undefined) {
        const updatedProducts = current.map((product) =>
          product.id === args.productId
            ? {
                ...product,
                ...(args.name !== undefined && { name: args.name }),
                ...(args.description !== undefined && {
                  description: args.description,
                }),
                ...(args.imageUrl !== undefined && { imageUrl: args.imageUrl }),
                ...(args.stock !== undefined && { stock: args.stock }),
                ...(args.price !== undefined && { price: args.price }),
                ...(args.currency !== undefined && { currency: args.currency }),
                ...(args.category !== undefined && { category: args.category }),
                lastUpdated: Date.now(),
              }
            : product,
        );
        localStore.setQuery(
          api.products.getAllProducts,
          { organizationId },
          updatedProducts,
        );
      }
    },
  );
}
