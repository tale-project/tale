'use client';

import { useMemo } from 'react';
import { Package } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { type Preloaded } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import {
  DataTable,
  DataTableEmptyState,
} from '@/components/ui/data-table';
import { HStack } from '@/components/ui/layout';
import { TableDateCell } from '@/components/ui/table-date-cell';
import ProductImage from './product-image';
import { ProductsActionMenu } from './products-action-menu';
import ProductRowActions from './product-row-actions';
import { useT } from '@/lib/i18n';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useOffsetPaginatedQuery } from '@/hooks/use-offset-paginated-query';
import { productFilterDefinitions } from './filter-definitions';

// Product type from the query
type Product = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  stock?: number;
  lastUpdated: number;
  metadata?: { url?: string };
};

export interface ProductTableProps {
  organizationId: string;
  preloadedProducts: Preloaded<typeof api.products.getProducts>;
}

export default function ProductTable({
  organizationId,
  preloadedProducts,
}: ProductTableProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');

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
    pagination: { defaultPageSize: 10 },
    sorting: { defaultSort: 'lastUpdated', defaultDesc: true },
  });

  // Use paginated query with SSR + real-time updates
  const { data, isLoading } = useOffsetPaginatedQuery({
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
  const emptyProducts = products.length === 0 && !hasActiveFilters;

  // Define columns using TanStack Table
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
        cell: ({ row }) => (
          <HStack justify="end">
            <ProductRowActions product={row.original} />
          </HStack>
        ),
      },
    ],
    [tTables],
  );

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
    [filterValues.status, setFilter, tTables],
  );

  // Show empty state when no products and no filters
  if (emptyProducts) {
    return (
      <DataTableEmptyState
        icon={Package}
        title={tProducts('emptyState.title')}
        description={tProducts('emptyState.description')}
        actionMenu={<ProductsActionMenu organizationId={organizationId} />}
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={products}
      getRowId={(row) => row.id}
      isLoading={isLoading}
      stickyLayout
      sorting={{
        initialSorting: sorting,
        onSortingChange: setSorting,
      }}
      search={{
        value: filterValues.query,
        onChange: (value) => setFilter('query', value),
        placeholder: tProducts('searchPlaceholder'),
      }}
      filters={filterConfigs}
      isFiltersLoading={isPending}
      onClearFilters={clearAll}
      actionMenu={<ProductsActionMenu organizationId={organizationId} />}
      emptyState={
        hasActiveFilters
          ? {
              title: tProducts('searchEmptyState.title'),
              description: tProducts('searchEmptyState.description'),
              isFiltered: true,
            }
          : undefined
      }
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
