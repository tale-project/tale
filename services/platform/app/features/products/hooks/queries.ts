import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import type { ItemOf } from '@/app/lib/backend/contract';

export type Product = ItemOf<'products/queries:listProducts'>;

export function useApproxProductCount(organizationId: string) {
  return useBackendQuery('products/queries:approxCountProducts', {
    organizationId,
  });
}

export function useProducts(organizationId: string) {
  const { data, isLoading } = useBackendQuery('products/queries:listProducts', {
    organizationId,
  });

  return {
    products: data ?? [],
    isLoading,
  };
}

interface ListProductsPaginatedArgs {
  organizationId: string;
  status?: string;
  category?: string;
  initialNumItems: number;
}

export function useListProductsPaginated(args: ListProductsPaginatedArgs) {
  const { initialNumItems, ...queryArgs } = args;
  return useCachedPaginatedQuery(
    'products/queries:listProductsPaginated',
    queryArgs,
    { initialNumItems },
  );
}
