import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import type { ItemOf } from '@/app/lib/backend/contract';

export type Website = ItemOf<'websites/queries:listWebsites'>;

export function useApproxWebsiteCount(organizationId: string) {
  return useBackendQuery('websites/queries:approxCountWebsites', {
    organizationId,
  });
}

export function useWebsites(organizationId: string) {
  const { data, isLoading } = useBackendQuery('websites/queries:listWebsites', {
    organizationId,
  });

  return {
    websites: data ?? [],
    isLoading,
  };
}

interface ListWebsitesPaginatedArgs {
  organizationId: string;
  status?: string;
  scanInterval?: string;
  initialNumItems: number;
}

export function useListWebsitesPaginated(args: ListWebsitesPaginatedArgs) {
  const { initialNumItems, ...queryArgs } = args;
  return useCachedPaginatedQuery(
    'websites/queries:listWebsitesPaginated',
    queryArgs,
    { initialNumItems },
  );
}
