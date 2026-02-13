import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Vendor } from '@/lib/collections/entities/vendors';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { api } from '@/convex/_generated/api';

export function useVendors(collection: Collection<Vendor, string>) {
  const { data, isLoading } = useLiveQuery(() => collection);

  return {
    vendors: data,
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
