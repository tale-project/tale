'use client';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';

import { useVendorsTableConfig } from '../hooks/use-vendors-table-config';
import { VendorsActionMenu } from './vendors-action-menu';

interface VendorsTableSkeletonProps {
  organizationId: string;
}

/** Skeleton-only version for Suspense fallback */
export function VendorsTableSkeleton({
  organizationId,
}: VendorsTableSkeletonProps) {
  const { columns, searchPlaceholder, stickyLayout, infiniteScroll } =
    useVendorsTableConfig();

  return (
    <DataTableSkeleton
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      actionMenu={<VendorsActionMenu organizationId={organizationId} />}
      infiniteScroll={infiniteScroll}
    />
  );
}
