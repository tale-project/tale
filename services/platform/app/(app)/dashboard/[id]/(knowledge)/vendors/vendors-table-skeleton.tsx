'use client';

import { DataTableSkeleton } from '@/components/ui/data-table/data-table-skeleton';
import { VendorsActionMenu } from './vendors-action-menu';
import { useVendorsTableConfig } from './use-vendors-table-config';

interface VendorsTableSkeletonProps {
  organizationId: string;
}

/** Skeleton-only version for Suspense fallback */
export function VendorsTableSkeleton({
  organizationId,
}: VendorsTableSkeletonProps) {
  const { columns, searchPlaceholder, stickyLayout } = useVendorsTableConfig();

  return (
    <DataTableSkeleton
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      actionMenu={<VendorsActionMenu organizationId={organizationId} />}
    />
  );
}
