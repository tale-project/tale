import type { AuditLogFilter } from '@/convex/audit_logs/types';

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
