'use client';

import { DataTableSkeleton } from '@/components/ui/data-table/data-table-skeleton';
import { useAutomationsTableConfig } from './use-automations-table-config';
import { AutomationsActionMenu } from './automations-action-menu';

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
      className="py-6 px-4"
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      actionMenu={<AutomationsActionMenu organizationId={organizationId} />}
      infiniteScroll={infiniteScroll}
    />
  );
}
