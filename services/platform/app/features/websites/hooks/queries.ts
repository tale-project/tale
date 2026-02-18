import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export type Website = ConvexItemOf<typeof api.websites.queries.listWebsites>;

export function useApproxWebsiteCount(organizationId: string) {
  return useConvexQuery(api.websites.queries.approxCountWebsites, {
    organizationId,
  });
}

export function useWebsites(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.websites.queries.listWebsites,
    { organizationId },
  );

  return {
    websites: data ?? [],
    isLoading,
  };
}

interface ListWebsitesPaginatedArgs {
  organizationId: string;
  status?: string;
  initialNumItems: number;
}

export function useListWebsitesPaginated(args: ListWebsitesPaginatedArgs) {
  const { initialNumItems, ...queryArgs } = args;
  return useCachedPaginatedQuery(
    api.websites.queries.listWebsitesPaginated,
    queryArgs,
    { initialNumItems },
  );
}
