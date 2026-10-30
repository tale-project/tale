import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';

export function useApproxProductCount(organizationId: string) {
  return useBackendQuery('products/queries:approxCountProducts', {
    organizationId,
  });
}

/** The categories the organization's products carry: the Category filter's
 * options. */
export function useProductCategories(organizationId: string) {
  return useBackendQuery('products/queries:listProductCategories', {
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
