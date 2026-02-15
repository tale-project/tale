'use client';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';

import { useWebsitesTableConfig } from '../hooks/use-websites-table-config';
import { WebsitesActionMenu } from './websites-action-menu';

interface WebsitesTableSkeletonProps {
  organizationId: string;
  rows?: number;
}

/** Skeleton-only version for Suspense fallback */
export function WebsitesTableSkeleton({
  organizationId,
  rows,
}: WebsitesTableSkeletonProps) {
  const { columns, searchPlaceholder, stickyLayout, infiniteScroll } =
    useWebsitesTableConfig();

  return (
    <DataTableSkeleton
      rows={rows}
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      actionMenu={<WebsitesActionMenu organizationId={organizationId} />}
      infiniteScroll={infiniteScroll}
    />
  );
}
