import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Product } from '@/lib/collections/entities/products';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { api } from '@/convex/_generated/api';

export function useProducts(collection: Collection<Product, string>) {
  const { data, isLoading } = useLiveQuery(() => collection);

  return {
    products: data,
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
