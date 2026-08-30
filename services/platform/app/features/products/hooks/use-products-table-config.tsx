'use client';

import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';
import type { ProductDoc } from '@/app/lib/backend/contract/docs';
import { formatCurrency } from '@/lib/utils/format/number';

import { ProductImage } from '../components/product-image';
import { ProductRowActions } from '../components/product-row-actions';
import { ProductStatusBadge } from '../components/product-status-badge';

export type Product = ProductDoc;

export const useProductsTableConfig = createTableConfigHook<ProductDoc>(
  {
    entityNamespace: 'products',
    defaultSort: 'lastUpdated',
  },
  ({ tTables, builders }) => [
    builders.createSelectColumn(),
    {
      accessorKey: 'name',
      header: tTables('headers.product'),
      size: 400,
      meta: { skeleton: { type: 'avatar-text' } },
      cell: ({ row }) => (
        <HStack gap={3}>
          <ProductImage
            images={row.original.imageUrl ? [row.original.imageUrl] : []}
            productName={row.original.name}
            className="size-8 shrink-0 rounded"
          />
          <Text as="span" variant="label" className="break-words">
            {row.original.name}
          </Text>
        </HStack>
      ),
    },
    // Description column dropped — at the table's row truncation width it
    // collapses to a few words and earns zero scannability vs the detail
    // view, which already shows the full description on click. Frees space
    // for the price/stock/category columns to breathe at sensible widths.
    {
      accessorKey: 'stock',
      header: () => (
        <span className="block w-full text-right">
          {tTables('headers.stock')}
        </span>
      ),
      size: 80,
      meta: { headerLabel: tTables('headers.stock') },
      cell: ({ row }) => (
        <span
          className={`block text-right text-xs ${
            row.original.stock === 0 ? 'text-red-600' : 'text-muted-foreground'
          }`}
        >
          {row.original.stock !== undefined ? row.original.stock : '-'}
        </span>
      ),
    },
    {
      accessorKey: 'price',
      header: () => (
        <span className="block w-full text-right">
          {tTables('headers.price')}
        </span>
      ),
      size: 100,
      meta: { headerLabel: tTables('headers.price') },
      cell: ({ row }) => (
        <span className="text-muted-foreground block text-right text-xs">
          {row.original.price !== undefined
            ? formatCurrency(row.original.price, row.original.currency || 'USD')
            : '-'}
        </span>
      ),
    },
    {
      accessorKey: 'category',
      header: tTables('headers.category'),
      size: 140,
      cell: ({ row }) => (
        <Text as="span" variant="caption" className="text-muted-foreground">
          {row.original.category || '-'}
        </Text>
      ),
    },
    {
      accessorKey: 'status',
      header: tTables('headers.status'),
      size: 110,
      cell: ({ row }) =>
        row.original.status ? (
          <ProductStatusBadge status={row.original.status} />
        ) : (
          <Text as="span" variant="caption" className="text-muted-foreground">
            -
          </Text>
        ),
    },
    builders.createDateColumn('lastUpdated', 'headers.updated', tTables, {
      alignRight: true,
    }),
    builders.createActionsColumn(ProductRowActions, 'product', { size: 56 }),
  ],
);
