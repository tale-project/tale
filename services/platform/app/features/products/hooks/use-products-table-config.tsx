'use client';

import type { Doc } from '@/convex/_generated/dataModel';
import { HStack } from '@/app/components/ui/layout/layout';
import { ProductImage } from '../components/product-image';
import { ProductRowActions } from '../components/product-row-actions';
import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';

export type Product = Doc<'products'>;

export const useProductsTableConfig = createTableConfigHook<'products'>(
  {
    entityNamespace: 'products',
    defaultSort: 'lastUpdated',
  },
  ({ tTables, builders }) => [
    {
      accessorKey: 'name',
      header: () => tTables('headers.product'),
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
      header: () => tTables('headers.description'),
      cell: ({ row }) => (
        <div className="max-w-sm truncate text-xs text-muted-foreground">
          {row.original.description ? `"${row.original.description}"` : '-'}
        </div>
      ),
    },
    {
      accessorKey: 'stock',
      header: () => tTables('headers.stock'),
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
    builders.createDateColumn('lastUpdated', 'headers.updated', tTables, {
      alignRight: true,
    }),
    builders.createActionsColumn(ProductRowActions, 'product', { size: 80 }),
  ],
);
