import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';

export function useApproxProductCount(organizationId: string) {
  return useBackendQuery('products/queries:approxCountProducts', {
    organizationId,
  });
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
