'use client';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';

import { useAutomationsTableConfig } from '../hooks/use-automations-table-config';
import { AutomationsActionMenu } from './automations-action-menu';

interface AutomationsTableSkeletonProps {
  organizationId: string;
  rows?: number;
}

/** Skeleton-only version for Suspense fallback */
export function AutomationsTableSkeleton({
  organizationId,
  rows,
}: AutomationsTableSkeletonProps) {
  const { columns, searchPlaceholder, stickyLayout, infiniteScroll } =
    useAutomationsTableConfig();

  return (
    <DataTableSkeleton
      rows={rows}
      className="px-4 py-6"
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      showFilters
      noFirstColumnAvatar
      actionMenu={<AutomationsActionMenu organizationId={organizationId} />}
      infiniteScroll={infiniteScroll}
    />
  );
}
