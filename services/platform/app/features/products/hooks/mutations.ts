import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateProduct() {
  return useConvexOptimisticMutation(
    api.products.mutations.createProduct,
    api.products.queries.listProducts,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: (
        {
          name,
          description,
          imageUrl,
          stock,
          price,
          currency,
          category,
          tags,
          status,
        },
        { insert },
      ) =>
        insert({
          _creationTime: Date.now(),
          name,
          description,
          imageUrl,
          stock,
          price,
          currency,
          category,
          tags,
          status: status ?? 'draft',
        }),
    },
  );
}

export function useDeleteProduct() {
  return useConvexOptimisticMutation(
    api.products.mutations.deleteProduct,
    api.products.queries.listProducts,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ productId }, { remove }) => remove(productId),
    },
  );
}

export function useUpdateProduct() {
  return useConvexOptimisticMutation(
    api.products.mutations.updateProduct,
    api.products.queries.listProducts,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ productId, ...changes }, { update }) =>
        update(productId, changes),
    },
  );
}
