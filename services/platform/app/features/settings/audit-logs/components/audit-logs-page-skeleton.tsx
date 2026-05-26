'use client';

import { HStack } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import {
  SettingsPageSkeleton,
  SettingsTabsSkeleton,
} from '@/app/features/settings/components/settings-skeleton';

import { useAuditLogTableConfig } from '../hooks/use-audit-log-table-config';

/**
 * Mirrors `<AuditLogsPage>`: settings header with two export buttons + a
 * 4-tab strip + sticky DataTable using the real audit-log column metadata so
 * column widths line up exactly.
 */
export function AuditLogsPageSkeleton() {
  const { columns, stickyLayout } = useAuditLogTableConfig();

  return (
    <SettingsPageSkeleton
      fitToContainer
      headerAction={
        <HStack gap={2}>
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </HStack>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <SettingsTabsSkeleton tabs={4} />
        <DataTableSkeleton
          columns={columns}
          rows={8}
          stickyLayout={stickyLayout}
          showFilters
          noFirstColumnAvatar
        />
      </div>
    </SettingsPageSkeleton>
  );
}
