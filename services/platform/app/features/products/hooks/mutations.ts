import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateProduct() {
  return useConvexMutation(api.products.mutations.createProduct);
}

export function useBulkCreateProducts() {
  return useConvexMutation(api.products.mutations.bulkCreateProducts);
}

export function useDeleteProduct() {
  return useConvexMutation(api.products.mutations.deleteProduct);
}

export function useUpdateProduct() {
  return useConvexMutation(api.products.mutations.updateProduct);
}
