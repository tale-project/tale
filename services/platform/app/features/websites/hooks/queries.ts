import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';

export function useApproxWebsiteCount(organizationId: string) {
  return useBackendQuery('websites/queries:approxCountWebsites', {
    organizationId,
  });
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
