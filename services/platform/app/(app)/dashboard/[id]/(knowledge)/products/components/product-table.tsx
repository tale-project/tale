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
import { useCursorPaginatedQuery } from '@/hooks/use-cursor-paginated-query';
import { productFilterDefinitions } from '../filter-definitions';

export interface ProductTableProps {
  organizationId: string;
  preloadedProducts: Preloaded<typeof api.products.getProductsCursor>;
}

export function ProductTable({
  organizationId,
  preloadedProducts,
}: ProductTableProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');

  // Use shared table config
  const { columns, searchPlaceholder, stickyLayout, pageSize } = useProductsTableConfig();

  // Use unified URL filters hook (without sorting for cursor-based pagination)
  const {
    filters: filterValues,
    setFilter,
    clearAll,
    isPending,
  } = useUrlFilters({
    filters: productFilterDefinitions,
    pagination: { defaultPageSize: pageSize },
  });

  // Valid product status values that the backend accepts
  const VALID_PRODUCT_STATUSES = new Set(['active', 'inactive', 'draft', 'archived']);
  type ProductStatus = 'active' | 'inactive' | 'draft' | 'archived';

  // Build query args for cursor-based pagination
  const queryArgs = useMemo(
    () => ({
      organizationId,
      searchQuery: filterValues.query || undefined,
      // Backend currently only supports single status filter - use first valid status
      status: (() => {
        const validStatus = filterValues.status.find(
          (s): s is ProductStatus => VALID_PRODUCT_STATUSES.has(s),
        );
        return validStatus;
      })(),
    }),
    [organizationId, filterValues],
  );

  // Use cursor-based paginated query with SSR + real-time updates
  const { data: products, isLoadingMore, hasMore, loadMore } =
    useCursorPaginatedQuery({
      query: api.products.getProductsCursor,
      preloadedData: preloadedProducts,
      args: queryArgs,
      numItems: pageSize,
    });

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
      infiniteScroll={{
        hasMore,
        onLoadMore: loadMore,
        isLoadingMore,
      }}
    />
  );
}
