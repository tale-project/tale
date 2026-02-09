'use client';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';

import { useExecutionsTableConfig } from './use-executions-table-config';

/** Skeleton-only version for Suspense fallback */
export function ExecutionsTableSkeleton() {
  const { columns, searchPlaceholder, stickyLayout, infiniteScroll } =
    useExecutionsTableConfig();

  return (
    <DataTableSkeleton
      className="px-4 py-6"
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      noFirstColumnAvatar
      infiniteScroll={infiniteScroll}
      showFilters
      showDateRange
      enableExpanding
    />
  );
}
