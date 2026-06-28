import {
  removeItemFromListQuery,
  updateItemInListQuery,
} from '@/app/hooks/optimistic-updates';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import {
  removeItemFromPaginatedQuery,
  updateItemInPaginatedQuery,
} from '@/app/hooks/use-convex-paginated-query';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';

export function useCreateProduct() {
  return useConvexMutation(api.products.mutations.createProduct, {
    // The create dialog shows its own specific error toast (duplicate-name vs
    // generic). Without this, the shared hook also fires a generic toast, so a
    // duplicate name surfaces two contradictory toasts.
    errorToast: false,
  });
}

export function useBulkCreateProducts() {
  return useConvexMutation(api.products.mutations.bulkCreateProducts);
}

export function useDeleteProduct() {
  return useConvexMutation(api.products.mutations.deleteProduct, {
    // EntityDeleteDialog shows its own specific error toast.
    errorToast: false,
    optimisticUpdate: (store, args) => {
      removeItemFromListQuery(
        store,
        api.products.queries.listProducts,
        args.productId,
      );
      removeItemFromPaginatedQuery(
        store,
        api.products.queries.listProductsPaginated,
        args.productId,
      );
    },
  });
}

export function useUpdateProduct() {
  return useConvexMutation(api.products.mutations.updateProduct, {
    // The edit dialog shows its own specific error toast.
    errorToast: false,
    optimisticUpdate: (store, args) => {
      // One merge function, reused for both the array and paginated views so a
      // field added to `updateProduct` only has to be wired here once.
      const applyEdits = (product: Doc<'products'>): Doc<'products'> => {
        const next = { ...product };
        if (args.name !== undefined) next.name = args.name;
        if (args.description !== undefined) next.description = args.description;
        if (args.price !== undefined) next.price = args.price;
        if (args.currency !== undefined) next.currency = args.currency;
        if (args.stock !== undefined) next.stock = args.stock;
        if (args.category !== undefined) next.category = args.category;
        if (args.status !== undefined) next.status = args.status;
        return next;
      };
      updateItemInListQuery(
        store,
        api.products.queries.listProducts,
        args.productId,
        applyEdits,
      );
      // Mirror the patch into the paginated view the products table renders.
      updateItemInPaginatedQuery(
        store,
        api.products.queries.listProductsPaginated,
        args.productId,
        applyEdits,
      );
    },
  });
}
