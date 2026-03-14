'use client';

import type { Doc } from '@/convex/_generated/dataModel';

import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';

import { ProductImage } from '../components/product-image';
import { ProductRowActions } from '../components/product-row-actions';

export type Product = Doc<'products'>;

export const useProductsTableConfig = createTableConfigHook<'products'>(
  {
    entityNamespace: 'products',
    defaultSort: 'lastUpdated',
  },
  ({ tTables, builders }) => [
    {
      accessorKey: 'name',
      header: tTables('headers.product'),
      size: 400,
      cell: ({ row }) => (
        <HStack gap={3}>
          <ProductImage
            images={row.original.imageUrl ? [row.original.imageUrl] : []}
            productName={row.original.name}
            className="size-8 shrink-0 rounded"
          />
          <Text as="span" variant="label">
            {row.original.name}
          </Text>
        </HStack>
      ),
    },
    {
      accessorKey: 'description',
      header: tTables('headers.description'),
      cell: ({ row }) => (
        <Text as="div" variant="caption" truncate className="max-w-sm">
          {row.original.description ? `"${row.original.description}"` : '-'}
        </Text>
      ),
    },
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
    builders.createDateColumn('lastUpdated', 'headers.updated', tTables, {
      alignRight: true,
    }),
    builders.createActionsColumn(ProductRowActions, 'product', { size: 56 }),
  ],
);
