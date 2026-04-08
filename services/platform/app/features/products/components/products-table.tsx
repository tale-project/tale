'use client';

import { useNavigate } from '@tanstack/react-router';
import type { Row, RowSelectionState } from '@tanstack/react-table';
import { Package } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
import { useListPage } from '@/app/hooks/use-list-page';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useDeleteProduct } from '../hooks/mutations';
import {
  useApproxProductCount,
  useListProductsPaginated,
} from '../hooks/queries';
import { useProductsTableConfig } from '../hooks/use-products-table-config';
import { ProductViewDialog } from './product-view-dialog';
import { ProductsActionMenu } from './products-action-menu';

type Product = Doc<'products'>;

export interface ProductsTableProps {
  organizationId: string;
  status?: string;
  category?: string;
}

export function ProductsTable({
  organizationId,
  status,
  category,
}: ProductsTableProps) {
  const navigate = useNavigate();
  const { t: tEmpty } = useT('emptyStates');
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');
  const { t: tProducts } = useT('products');

  const { data: count } = useApproxProductCount(organizationId);
  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useProductsTableConfig();
  const paginatedResult = useListProductsPaginated({
    organizationId,
    status,
    category,
    initialNumItems: pageSize,
  });

  const handleStatusChange = useCallback(
    (values: string[]) => {
      void navigate({
        to: '/dashboard/$id/products',
        params: { id: organizationId },
        search: (prev) => ({
          ...prev,
          status: values[0] || undefined,
        }),
      });
    },
    [navigate, organizationId],
  );

  const handleClearFilters = useCallback(() => {
    void navigate({
      to: '/dashboard/$id/products',
      params: { id: organizationId },
      search: {},
    });
  }, [navigate, organizationId]);

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
        selectedValues: status ? [status] : [],
        onChange: handleStatusChange,
      },
    ],
    [status, tTables, tCommon, handleStatusChange],
  );

  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const deleteProduct = useDeleteProduct();

  const handleRowClick = useCallback((row: Row<Product>) => {
    setViewingProduct(row.original);
  }, []);

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleDeleteItem = useCallback(
    async (id: string) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex Id type from row selection key
      const productId = id as Doc<'products'>['_id'];
      await deleteProduct.mutateAsync({ productId });
    },
    [deleteProduct],
  );

  const list = useListPage<Product>({
    dataSource: {
      type: 'paginated',
      results: paginatedResult.results,
      status: paginatedResult.status,
      loadMore: paginatedResult.loadMore,
      isLoading: paginatedResult.isLoading,
    },
    pageSize,
    displayMode: 'pagination',
    search: {
      fields: ['name', 'description', 'category'],
      placeholder: searchPlaceholder,
    },
    filters: {
      configs: filterConfigs,
      onClear: handleClearFilters,
    },
    approxRowCount: count,
    entityLabel: tProducts('title').toLowerCase(),
  });

  return (
    <>
      <DataTable
        columns={columns}
        stickyLayout={stickyLayout}
        onRowClick={handleRowClick}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        actionMenu={<ProductsActionMenu organizationId={organizationId} />}
        emptyState={{
          icon: Package,
          title: tEmpty('products.title'),
          description: tEmpty('products.description'),
        }}
        footer={
          <BulkDeleteBar
            rowSelection={rowSelection}
            onClearSelection={handleClearSelection}
            onDeleteItem={handleDeleteItem}
            onDeleteComplete={handleClearSelection}
          />
        }
        {...list.tableProps}
      />

      {viewingProduct && (
        <ProductViewDialog
          isOpen={!!viewingProduct}
          onClose={() => setViewingProduct(null)}
          product={viewingProduct}
        />
      )}
    </>
  );
}
