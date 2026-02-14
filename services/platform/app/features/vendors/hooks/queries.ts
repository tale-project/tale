import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export type Vendor = ConvexItemOf<typeof api.vendors.queries.listVendors>;

export function useVendors(organizationId: string) {
  const { data, isLoading } = useConvexQuery(api.vendors.queries.listVendors, {
    organizationId,
  });

  return {
    vendors: data ?? [],
    isLoading,
  };
}

interface ListVendorsPaginatedArgs {
  organizationId: string;
  source?: string;
  locale?: string;
  initialNumItems: number;
}

export function useListVendorsPaginated(args: ListVendorsPaginatedArgs) {
  const { initialNumItems, ...queryArgs } = args;
  return useCachedPaginatedQuery(
    api.vendors.queries.listVendorsPaginated,
    queryArgs,
    { initialNumItems },
  );
}
