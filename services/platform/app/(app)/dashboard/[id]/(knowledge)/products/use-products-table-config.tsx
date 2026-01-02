'use client';

import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { HStack } from '@/components/ui/layout';
import { TableDateCell } from '@/components/ui/table-date-cell';
import { ProductImage } from './product-image';
import { ProductRowActions } from './product-row-actions';
import { useT } from '@/lib/i18n';

// Product type from the query
export type Product = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  stock?: number;
  lastUpdated: number;
  metadata?: { url?: string };
};

/** Shared table configuration for products - used by both table and skeleton */
export function useProductsTableConfig() {
  const { t: tTables } = useT('tables');
  const { t: tProducts } = useT('products');

  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tTables('headers.product'),
        size: 400,
        cell: ({ row }) => (
          <HStack gap={3}>
            <ProductImage
              images={row.original.imageUrl ? [row.original.imageUrl] : []}
              productName={row.original.name}
              className="size-8 rounded shrink-0"
            />
            <span className="font-medium text-sm text-foreground">
              {row.original.name}
            </span>
          </HStack>
        ),
      },
      {
        accessorKey: 'description',
        header: tTables('headers.description'),
        cell: ({ row }) => (
          <div className="max-w-sm truncate text-xs text-muted-foreground">
            {row.original.description ? `"${row.original.description}"` : '-'}
          </div>
        ),
      },
      {
        accessorKey: 'stock',
        header: tTables('headers.stock'),
        size: 80,
        cell: ({ row }) => (
          <span
            className={`text-xs ${
              row.original.stock === 0
                ? 'text-red-600'
                : 'text-muted-foreground'
            }`}
          >
            {row.original.stock !== undefined ? row.original.stock : '-'}
          </span>
        ),
      },
      {
        accessorKey: 'lastUpdated',
        header: () => (
          <span className="text-right w-full block">
            {tTables('headers.updated')}
          </span>
        ),
        size: 140,
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.lastUpdated}
            preset="short"
            alignRight
            className="text-xs"
          />
        ),
      },
      {
        id: 'actions',
        size: 80,
        meta: { isAction: true },
        cell: ({ row }) => (
          <HStack justify="end">
            <ProductRowActions product={row.original} />
          </HStack>
        ),
      },
    ],
    [tTables],
  );

  return {
    columns,
    searchPlaceholder: tProducts('searchPlaceholder'),
    stickyLayout: true as const,
    pageSize: 10,
    defaultSort: 'lastUpdated' as const,
    defaultSortDesc: true,
  };
}
