import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';

/**
 * Rows per page of the Audit and Error listings. Held here rather than passed
 * in: the logs page's filter bar watches the same listing its active tab reads,
 * and one cache entry has to be fetched with one page size.
 */
const LOGS_PAGE_SIZE = 30;

interface ListAuditLogsPaginatedArgs {
  /** `undefined` skips the read. */
  organizationId: string | undefined;
  category?: string;
  resourceType?: string;
}

export function useListAuditLogsPaginated({
  organizationId,
  ...filters
}: ListAuditLogsPaginatedArgs) {
  return useCachedPaginatedQuery(
    'audit_logs/queries:listAuditLogsPaginated',
    organizationId === undefined ? 'skip' : { organizationId, ...filters },
    { initialNumItems: LOGS_PAGE_SIZE },
  );
}

interface ListErrorLogsPaginatedArgs {
  /** `undefined` skips the read. */
  organizationId: string | undefined;
  category?: string;
}

export function useListErrorLogsPaginated({
  organizationId,
  ...filters
}: ListErrorLogsPaginatedArgs) {
  return useCachedPaginatedQuery(
    'audit_logs/queries:listErrorLogsPaginated',
    organizationId === undefined ? 'skip' : { organizationId, ...filters },
    { initialNumItems: LOGS_PAGE_SIZE },
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
