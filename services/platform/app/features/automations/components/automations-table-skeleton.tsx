'use client';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';

import { AutomationsActionMenu } from './automations-action-menu';
import { useAutomationsTableConfig } from './use-automations-table-config';

interface AutomationsTableSkeletonProps {
  organizationId: string;
}

/** Skeleton-only version for Suspense fallback */
export function AutomationsTableSkeleton({
  organizationId,
}: AutomationsTableSkeletonProps) {
  const { columns, searchPlaceholder, stickyLayout, infiniteScroll } =
    useAutomationsTableConfig();

  return (
    <DataTableSkeleton
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
