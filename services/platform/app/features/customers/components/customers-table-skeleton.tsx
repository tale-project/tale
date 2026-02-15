'use client';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';

import { useCustomersTableConfig } from '../hooks/use-customers-table-config';
import { CustomersActionMenu } from './customers-action-menu';

interface CustomersTableSkeletonProps {
  organizationId: string;
  rows?: number;
}

/** Skeleton-only version for Suspense fallback */
export function CustomersTableSkeleton({
  organizationId,
  rows,
}: CustomersTableSkeletonProps) {
  const { columns, searchPlaceholder, stickyLayout, infiniteScroll } =
    useCustomersTableConfig();

  return (
    <DataTableSkeleton
      rows={rows}
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      actionMenu={<CustomersActionMenu organizationId={organizationId} />}
      infiniteScroll={infiniteScroll}
    />
  );
}
