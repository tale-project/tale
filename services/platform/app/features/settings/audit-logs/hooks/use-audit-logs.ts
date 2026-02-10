import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';

import type { AuditLogFilter } from '@/convex/audit_logs/types';

import { api } from '@/convex/_generated/api';

export function useAuditLogs(
  organizationId: string,
  filter?: AuditLogFilter,
  limit = 50,
) {
  return useQuery(
    convexQuery(api.audit_logs.queries.listAuditLogs, {
      organizationId,
      filter,
      limit,
    }),
  );
}

export function useActivitySummary(
  organizationId: string,
  startDate?: number,
  endDate?: number,
) {
  return useQuery(
    convexQuery(api.audit_logs.queries.getActivitySummary, {
      organizationId,
      startDate,
      endDate,
    }),
  );
}
