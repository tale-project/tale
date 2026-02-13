import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateProduct() {
  const { mutateAsync } = useConvexMutation(
    api.products.mutations.createProduct,
  );
  return mutateAsync;
}

export function useDeleteProduct() {
  const { mutateAsync } = useConvexMutation(
    api.products.mutations.deleteProduct,
  );
  return mutateAsync;
}

export function useUpdateProduct() {
  const { mutateAsync } = useConvexMutation(
    api.products.mutations.updateProduct,
  );
  return mutateAsync;
}
