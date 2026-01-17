'use client';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { ProductsActionMenu } from './products-action-menu';
import { useProductsTableConfig } from '../hooks/use-products-table-config';

interface ProductTableSkeletonProps {
  organizationId: string;
}

/** Skeleton-only version for Suspense fallback */
export function ProductTableSkeleton({
  organizationId,
}: ProductTableSkeletonProps) {
  const { columns, searchPlaceholder, stickyLayout, infiniteScroll } =
    useProductsTableConfig();

  return (
    <DataTableSkeleton
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      actionMenu={<ProductsActionMenu organizationId={organizationId} />}
      infiniteScroll={infiniteScroll}
    />
  );
}
