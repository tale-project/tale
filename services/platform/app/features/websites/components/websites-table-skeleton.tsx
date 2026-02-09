'use client';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';

import { useWebsitesTableConfig } from '../hooks/use-websites-table-config';
import { WebsitesActionMenu } from './websites-action-menu';

interface WebsitesTableSkeletonProps {
  organizationId: string;
}

/** Skeleton-only version for Suspense fallback */
export function WebsitesTableSkeleton({
  organizationId,
}: WebsitesTableSkeletonProps) {
  const { columns, searchPlaceholder, stickyLayout, infiniteScroll } =
    useWebsitesTableConfig();

  return (
    <DataTableSkeleton
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      actionMenu={<WebsitesActionMenu organizationId={organizationId} />}
      infiniteScroll={infiniteScroll}
    />
  );
}
