'use client';

import { useMemo, useState } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { Package } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { ProductsActionMenu } from './products-action-menu';
import { useProductsTableConfig } from '../hooks/use-products-table-config';
import { useT } from '@/lib/i18n/client';
import {
  filterByTextSearch,
  filterByFields,
} from '@/lib/utils/client-utils';

export interface ProductTableProps {
  organizationId: string;
}

export function ProductTable({ organizationId }: ProductTableProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useProductsTableConfig();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [displayCount, setDisplayCount] = useState(pageSize);

  const { results, status, loadMore, isLoading } = usePaginatedQuery(
    api.products.queries.listProducts,
    { organizationId },
    { initialNumItems: pageSize },
  );

  const processed = useMemo(() => {
    if (!results) return [];

    let data = [...results];

    if (search) {
      data = filterByTextSearch(data, search, ['name', 'description', 'category']);
    }

    if (statusFilter.length > 0) {
      data = filterByFields(data, [
        { field: 'status', values: new Set(statusFilter) },
      ]);
    }

    return data;
  }, [results, search, statusFilter]);

  const displayedProducts = useMemo(
    () => processed.slice(0, displayCount),
    [processed, displayCount],
  );

  const hasMore =
    displayCount < processed.length ||
    status === 'CanLoadMore' ||
    status === 'LoadingMore';

  const handleLoadMore = () => {
    if (displayCount >= processed.length && status === 'CanLoadMore') {
      loadMore(pageSize);
    }
    setDisplayCount((prev) => prev + pageSize);
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
        onLoadMore: handleLoadMore,
        isLoadingMore: status === 'LoadingMore',
        isInitialLoading: status === 'LoadingFirstPage',
      }}
    />
  );
}
