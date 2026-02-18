import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export type Product = ConvexItemOf<typeof api.products.queries.listProducts>;

export function useApproxProductCount(organizationId: string) {
  return useConvexQuery(api.products.queries.approxCountProducts, {
    organizationId,
  });
}

export function useProducts(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.products.queries.listProducts,
    { organizationId },
  );

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
    api.products.queries.listProductsPaginated,
    queryArgs,
    { initialNumItems },
  );
}
