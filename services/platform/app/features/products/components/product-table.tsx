'use client';

import { usePaginatedQuery } from 'convex/react';
import { Package } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { ProductsActionMenu } from './products-action-menu';
import { useProductsTableConfig } from '../hooks/use-products-table-config';
import { useT } from '@/lib/i18n/client';
import { useListPage } from '@/app/hooks/use-list-page';

export interface ProductTableProps {
  organizationId: string;
}

export function ProductTable({ organizationId }: ProductTableProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useProductsTableConfig();

  const paginatedResult = usePaginatedQuery(
    api.products.queries.listProducts,
    { organizationId },
    { initialNumItems: pageSize },
  );

  const list = useListPage({
    dataSource: { type: 'paginated', ...paginatedResult },
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
