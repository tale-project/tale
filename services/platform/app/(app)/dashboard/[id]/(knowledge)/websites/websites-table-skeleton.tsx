'use client';

import { DataTableSkeleton } from '@/components/ui/data-table/data-table-skeleton';
import { WebsitesActionMenu } from './websites-action-menu';
import { useWebsitesTableConfig } from './use-websites-table-config';

interface WebsitesTableSkeletonProps {
  organizationId: string;
}

/** Skeleton-only version for Suspense fallback */
export function WebsitesTableSkeleton({
  organizationId,
}: WebsitesTableSkeletonProps) {
  const { columns, searchPlaceholder, stickyLayout } = useWebsitesTableConfig();

  return (
    <DataTableSkeleton
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      actionMenu={<WebsitesActionMenu organizationId={organizationId} />}
    />
  );
}
