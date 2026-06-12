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
 * (inactive Radix tab content is unmounted).
 */
export function ErrorLogTable({
  organizationId,
  category,
  userEmailMap,
}: ErrorLogTableProps) {
  const paginatedResult = useListErrorLogsPaginated({
    organizationId,
    category,
    initialNumItems: 30,
  });

  return (
    <AuditLogTable
      paginatedResult={paginatedResult}
      userEmailMap={userEmailMap}
      variant="errors"
    />
  );
}
