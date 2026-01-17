import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useDeleteProduct(organizationId: string) {
  return useMutation(api.products.deleteProduct).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.products.getAllProducts, {
        organizationId,
      });

      if (current !== undefined) {
        const updatedProducts = current.filter(
          (product) => product.id !== args.productId,
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
