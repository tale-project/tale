'use client';

import { useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { ProductsActionMenu } from './products-action-menu';
import { useProductsTableConfig } from '../hooks/use-products-table-config';
import { useT } from '@/lib/i18n/client';
import { useProductsData } from '@/app/hooks/use-products-data';

export interface ProductTableProps {
  organizationId: string;
}

export function ProductTable({ organizationId }: ProductTableProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');

  const { columns, searchPlaceholder, stickyLayout, pageSize, defaultSort, defaultSortDesc } =
    useProductsTableConfig();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [displayCount, setDisplayCount] = useState(pageSize);

  const { data: products, filteredCount } = useProductsData({
    organizationId,
    search: search || undefined,
    status: statusFilter.length > 0 ? statusFilter : [],
    sortBy: defaultSort as 'name' | 'createdAt' | 'lastUpdated' | 'stock' | 'price',
    sortOrder: defaultSortDesc ? 'desc' : 'asc',
  });

  const displayedProducts = useMemo(
    () => products.slice(0, displayCount),
    [products, displayCount],
  );

  const hasMore = displayCount < filteredCount;

  const loadMore = () => {
    setDisplayCount((prev) => Math.min(prev + pageSize, filteredCount));
  };

  const filterConfigs = useMemo(
    () => [
      {
        key: 'status',
        title: tTables('headers.status'),
        options: [
          { value: 'active', label: tCommon('status.active') },
          { value: 'inactive', label: tCommon('status.inactive') },
          { value: 'draft', label: tCommon('status.draft') },
          { value: 'archived', label: tCommon('status.archived') },
        ],
        selectedValues: statusFilter,
        onChange: (values: string[]) => {
          setStatusFilter(values);
          setDisplayCount(pageSize);
        },
      },
    ],
    [statusFilter, tTables, tCommon, pageSize],
  );

  const clearAll = () => {
    setSearch('');
    setStatusFilter([]);
    setDisplayCount(pageSize);
  };

  return (
    <DataTable
      columns={columns}
      data={displayedProducts}
      getRowId={(row) => row._id}
      stickyLayout={stickyLayout}
      search={{
        value: search,
        onChange: (value) => {
          setSearch(value);
          setDisplayCount(pageSize);
        },
        placeholder: searchPlaceholder,
      }}
      filters={filterConfigs}
      onClearFilters={clearAll}
      actionMenu={<ProductsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Package,
        title: tProducts('emptyState.title'),
        description: tProducts('emptyState.description'),
      }}
      infiniteScroll={{
        hasMore,
        onLoadMore: loadMore,
        isLoadingMore: false,
      }}
    />
  );
}
