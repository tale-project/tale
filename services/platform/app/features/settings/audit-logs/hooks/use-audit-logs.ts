import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { AuditLogFilter } from '@/convex/audit_logs/types';

export function useAuditLogs(
  organizationId: string,
  filter?: AuditLogFilter,
  limit = 50,
) {
  return useQuery(api.audit_logs.queries.listAuditLogs, {
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
  return useQuery(api.audit_logs.queries.getActivitySummary, {
    organizationId,
    startDate,
    endDate,
  });
}
