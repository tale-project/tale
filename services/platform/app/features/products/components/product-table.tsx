'use client';

import { Package } from 'lucide-react';

import type { Product } from '@/lib/collections/entities/products';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useProductsTableConfig } from '../hooks/use-products-table-config';
import { ProductsActionMenu } from './products-action-menu';

export interface ProductTableProps {
  organizationId: string;
  products: Product[];
}

export function ProductTable({ organizationId, products }: ProductTableProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useProductsTableConfig();

  const list = useListPage({
    dataSource: { type: 'query', data: products },
    pageSize,
    search: {
      fields: ['name', 'description', 'category'],
      placeholder: searchPlaceholder,
    },
    filters: {
      definitions: [
        {
          key: 'status',
          title: tTables('headers.status'),
          options: [
            { value: 'active', label: tCommon('status.active') },
            { value: 'inactive', label: tCommon('status.inactive') },
            { value: 'draft', label: tCommon('status.draft') },
            { value: 'archived', label: tCommon('status.archived') },
          ],
        },
      ],
    },
  });

  return (
    <DataTable
      columns={columns}
      stickyLayout={stickyLayout}
      actionMenu={<ProductsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Package,
        title: tProducts('emptyState.title'),
        description: tProducts('emptyState.description'),
      }}
      {...list.tableProps}
    />
  );
}
