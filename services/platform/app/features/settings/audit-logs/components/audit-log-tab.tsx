'use client';

import { AuditLogTable } from '@/app/features/settings/audit-logs/components/audit-log-table';
import { useListAuditLogsPaginated } from '@/app/features/settings/audit-logs/hooks/queries';

interface AuditLogTabProps {
  organizationId: string;
  /** Category filter the page-level filter UI drives for the audit tab. */
  category?: string;
  userEmailMap?: Map<string, string>;
  /**
   * When set, reveal this row's detail dialog (notification deep link or the
   * integrity panel's "open broken row").
   */
  revealLogId?: string;
  /**
   * Bumps whenever a fresh reveal is requested, so the same `revealLogId`
   * re-opens after the dialog was closed.
   */
  revealNonce?: number;
}

/**
 * "Audit logs" tab — the full audit trail, row by row. Owns its paginated
 * query (mirroring {@link ErrorLogTable}) so the read lives *inside* the
 * tab's `LogsTableBoundary`: a timed-out page then degrades to that boundary's
 * skeleton/retry instead of escalating to the page-level error boundary.
 */
export function AuditLogTab({
  organizationId,
  category,
  userEmailMap,
  revealLogId,
  revealNonce,
}: AuditLogTabProps) {
  const paginatedResult = useListAuditLogsPaginated({
    organizationId,
    category,
    initialNumItems: 30,
  });

  return (
    <AuditLogTable
      paginatedResult={paginatedResult}
      userEmailMap={userEmailMap}
      organizationId={organizationId}
      revealLogId={revealLogId}
      revealNonce={revealNonce}
    />
  );
}
