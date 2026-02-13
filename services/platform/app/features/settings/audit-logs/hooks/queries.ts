import type { AuditLogFilter } from '@/convex/audit_logs/types';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useListAuditLogs(
  organizationId: string,
  filter?: AuditLogFilter,
  limit = 50,
) {
  return useConvexQuery(api.audit_logs.queries.listAuditLogs, {
    organizationId,
    filter,
    limit,
  });
}

interface ListAuditLogsPaginatedArgs {
  organizationId: string;
  category?: string;
  resourceType?: string;
  initialNumItems: number;
}

export function useListAuditLogsPaginated(args: ListAuditLogsPaginatedArgs) {
  const { initialNumItems, ...queryArgs } = args;
  return useCachedPaginatedQuery(
    api.audit_logs.queries.listAuditLogsPaginated,
    queryArgs,
    { initialNumItems },
  );
}

export function useActivitySummary(
  organizationId: string,
  startDate?: number,
  endDate?: number,
) {
  return useConvexQuery(api.audit_logs.queries.getActivitySummary, {
    organizationId,
    startDate,
    endDate,
  });
}
