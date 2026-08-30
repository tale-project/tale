import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import type { AuditLogFilter } from '@/convex/audit_logs/types';

export function useListAuditLogs(
  organizationId: string,
  filter?: AuditLogFilter,
  limit = 50,
) {
  return useBackendQuery('audit_logs/queries:listAuditLogs', {
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
    'audit_logs/queries:listAuditLogsPaginated',
    queryArgs,
    { initialNumItems },
  );
}

interface ListErrorLogsPaginatedArgs {
  organizationId: string;
  category?: string;
  initialNumItems: number;
}

export function useListErrorLogsPaginated(args: ListErrorLogsPaginatedArgs) {
  const { initialNumItems, ...queryArgs } = args;
  return useCachedPaginatedQuery(
    'audit_logs/queries:listErrorLogsPaginated',
    queryArgs,
    { initialNumItems },
  );
}

export function useActivitySummary(
  organizationId: string,
  periodDays: 7 | 30 | 90,
) {
  return useBackendQuery('audit_logs/queries:getActivitySummary', {
    organizationId,
    periodDays,
  });
}
