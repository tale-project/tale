'use client';

import { useMemo } from 'react';
import { Package } from 'lucide-react';
import { type Preloaded } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { DataTable } from '@/components/ui/data-table';
import { ProductsActionMenu } from './products-action-menu';
import { useProductsTableConfig, type Product } from '../hooks/use-products-table-config';
import { useT } from '@/lib/i18n';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useOffsetPaginatedQuery } from '@/hooks/use-offset-paginated-query';
import { productFilterDefinitions } from '../filter-definitions';

export interface ProductTableProps {
  organizationId: string;
  preloadedProducts: Preloaded<typeof api.products.getProducts>;
}

export function ProductTable({
  organizationId,
  preloadedProducts,
}: ProductTableProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');

  // Use shared table config
  const { columns, searchPlaceholder, stickyLayout, pageSize, defaultSort, defaultSortDesc } = useProductsTableConfig();

  // Use unified URL filters hook with sorting
  const {
    filters: filterValues,
    sorting,
    setSorting,
    pagination,
    setFilter,
    setPage,
    setPageSize,
    clearAll,
    hasActiveFilters,
    isPending,
  } = useUrlFilters({
    filters: productFilterDefinitions,
    pagination: { defaultPageSize: pageSize },
    sorting: { defaultSort, defaultDesc: defaultSortDesc },
  });

  // Use paginated query with SSR + real-time updates
  const { data } = useOffsetPaginatedQuery({
    query: api.products.getProducts,
    preloadedData: preloadedProducts,
    organizationId,
    filters: {
      filters: filterValues,
      sorting,
      pagination,
      setFilter,
      setSorting,
      setPage,
      setPageSize,
      clearAll,
      hasActiveFilters,
      isPending,
      definitions: productFilterDefinitions,
    },
    transformFilters: (f) => ({
      searchQuery: f.query || undefined,
      // The backend currently only supports a single status filter
      status:
        f.status.length === 1
          ? (f.status[0] as 'active' | 'inactive' | 'draft' | 'archived')
          : undefined,
      sortBy: sorting[0]?.id as
        | 'name'
        | 'createdAt'
        | 'lastUpdated'
        | 'stock'
        | 'price'
        | undefined,
      sortOrder: sorting[0]
        ? sorting[0].desc
          ? ('desc' as const)
          : ('asc' as const)
        : undefined,
    }),
  });

  const products = data?.products ?? [];

  // Build filter configs for DataTableFilters component
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
        selectedValues: filterValues.status,
        onChange: (values: string[]) => setFilter('status', values),
      },
    ],
    [filterValues.status, setFilter, tTables, tCommon],
  );

  return (
    <DataTable
      columns={columns}
      data={products}
      getRowId={(row) => row.id}
      stickyLayout={stickyLayout}
      sorting={{
        initialSorting: sorting,
        onSortingChange: setSorting,
      }}
      search={{
        value: filterValues.query,
        onChange: (value) => setFilter('query', value),
        placeholder: searchPlaceholder,
      }}
      filters={filterConfigs}
      isFiltersLoading={isPending}
      onClearFilters={clearAll}
      actionMenu={<ProductsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Package,
        title: tProducts('emptyState.title'),
        description: tProducts('emptyState.description'),
      }}
      pagination={{
        total: data?.total ?? 0,
        pageSize: pagination.pageSize,
        totalPages: Math.ceil((data?.total ?? 0) / pagination.pageSize),
        hasNextPage: data?.hasNextPage ?? false,
        hasPreviousPage: pagination.page > 1,
        onPageChange: setPage,
        onPageSizeChange: setPageSize,
        clientSide: false,
      }}
      currentPage={pagination.page}
    />
  );
}
