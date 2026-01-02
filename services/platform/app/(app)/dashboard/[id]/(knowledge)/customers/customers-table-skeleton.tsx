'use client';

import { DataTableSkeleton } from '@/components/ui/data-table/data-table-skeleton';
import { CustomersActionMenu } from './customers-action-menu';
import { useCustomersTableConfig } from './use-customers-table-config';

interface CustomersTableSkeletonProps {
  organizationId: string;
}

/** Skeleton-only version for Suspense fallback */
export function CustomersTableSkeleton({
  organizationId,
}: CustomersTableSkeletonProps) {
  const { columns, searchPlaceholder, stickyLayout } = useCustomersTableConfig();

  return (
    <DataTableSkeleton
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      actionMenu={<CustomersActionMenu organizationId={organizationId} />}
    />
  );
}
