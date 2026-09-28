'use client';

import { AuditLogTable } from '@/app/features/settings/audit-logs/components/audit-log-table';
import { useListErrorLogsPaginated } from '@/app/features/settings/audit-logs/hooks/queries';

interface ErrorLogTableProps {
  organizationId: string;
  /** Same category filter the page-level filter UI drives for the audit tab. */
  category?: string;
  userEmailMap?: Map<string, string>;
}

/**
 * "Error logs" tab — the failure/denied slice of the audit trail. Owns its
 * paginated query so the page only pays for it while the tab is active
 * (inactive Radix tab content is unmounted), and so the read lives inside the
 * tab's `LogsTableBoundary`.
 *
 * `AuditLogsPage` also subscribes to this listing while the tab is on show,
 * outside the boundary, to disable its category filter over an empty trail.
 * That is safe only because the paginated lane never throws — a failure
 * settles as the result's `error` — so throw-on-error or suspense on it would
 * carry a failure past the boundary through the page's read.
 */
export function ErrorLogTable({
  organizationId,
  category,
  userEmailMap,
}: ErrorLogTableProps) {
  const paginatedResult = useListErrorLogsPaginated({
    organizationId,
    category,
  });

  return (
    <AuditLogTable
      paginatedResult={paginatedResult}
      userEmailMap={userEmailMap}
      variant="errors"
    />
  );
}
