import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import type { ErasureStatus } from '@/backend/core/governance/erasure_constants';

export function useListErasureRequests(args: {
  organizationId: string | undefined;
  statuses?: ErasureStatus[];
  initialNumItems?: number;
}) {
  return useCachedPaginatedQuery(
    'governance/erasure_queries:listErasureRequests',
    args.organizationId
      ? {
          organizationId: args.organizationId,
          statuses:
            args.statuses && args.statuses.length > 0
              ? args.statuses
              : undefined,
        }
      : 'skip',
    { initialNumItems: args.initialNumItems ?? DEFAULT_LIST_PAGE_SIZE },
  );
}

export function useGetErasureRequest(requestId: string | undefined) {
  return useBackendQuery(
    'governance/erasure_queries:getErasureRequest',
    requestId ? { requestId } : 'skip',
  );
}
