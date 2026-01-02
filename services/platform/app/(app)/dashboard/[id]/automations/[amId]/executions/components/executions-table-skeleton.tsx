'use client';

import { DataTableSkeleton } from '@/components/ui/data-table/data-table-skeleton';
import { useExecutionsTableConfig } from './use-executions-table-config';

/** Skeleton-only version for Suspense fallback */
export function ExecutionsTableSkeleton() {
  const { columns, searchPlaceholder, stickyLayout } = useExecutionsTableConfig();

  return (
    <DataTableSkeleton
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      noFirstColumnAvatar
    />
  );
}
