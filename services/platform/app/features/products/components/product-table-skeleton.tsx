'use client';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';

import { useProductsTableConfig } from '../hooks/use-products-table-config';
import { ProductsActionMenu } from './products-action-menu';

interface ProductTableSkeletonProps {
  organizationId: string;
  rows?: number;
}

/** Skeleton-only version for Suspense fallback */
export function ProductTableSkeleton({
  organizationId,
  rows,
}: ProductTableSkeletonProps) {
  const { columns, searchPlaceholder, stickyLayout, infiniteScroll } =
    useProductsTableConfig();

  return (
    <DataTableSkeleton
      rows={rows}
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      actionMenu={<ProductsActionMenu organizationId={organizationId} />}
      infiniteScroll={infiniteScroll}
    />
  );
}
