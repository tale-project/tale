'use client';

import { useMemo } from 'react';
import { usePreloadedQuery } from 'convex/react';
import { Package, MoreVertical, ExternalLink } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { type Preloaded } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDate } from '@/lib/utils/date/format';
import ProductImage from './product-image';
import ProductSearch from './product-search';
import ImportProductsMenu from './import-products-menu';
import ProductActions from './product-actions';

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
  currentPage: number;
  searchQuery?: string;
  pageSize?: number;
  preloadedProducts: Preloaded<typeof api.products.getProducts>;
}

export default function ProductTable({
  organizationId,
  currentPage,
  searchQuery,
  pageSize = 10,
  preloadedProducts,
}: ProductTableProps) {
  // Use preloaded data with real-time reactivity
  const { products, total, hasNextPage } = usePreloadedQuery(preloadedProducts);

  const emptyProducts = products.length === 0 && !searchQuery;

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Product',
        size: 400,
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <ProductImage
              images={row.original.imageUrl ? [row.original.imageUrl] : []}
              productName={row.original.name}
              className="size-8 rounded shrink-0"
            />
            <span className="font-medium text-sm text-foreground">
              {row.original.name}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'description',
        header: 'Description',
        cell: ({ row }) => (
          <div className="max-w-sm truncate text-xs text-muted-foreground">
            {row.original.description ? `"${row.original.description}"` : '-'}
          </div>
        ),
      },
      {
        accessorKey: 'stock',
        header: 'Stock',
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
        header: () => <span className="text-right w-full block">Updated</span>,
        size: 140,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground text-right block">
            {formatDate(new Date(row.original.lastUpdated), {
              preset: 'short',
            })}
          </span>
        ),
      },
      {
        id: 'actions',
        size: 80,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="size-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[160px]">
                <ProductActions product={row.original} />
                {typeof row.original.metadata?.url === 'string' && (
                  <DropdownMenuItem asChild>
                    <a
                      href={row.original.metadata.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center"
                    >
                      <ExternalLink className="size-4 mr-2" />
                      View Source
                    </a>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [],
  );

  // Show empty state when no products and no search
  if (emptyProducts) {
    return (
      <DataTableEmptyState
        icon={Package}
        title="No products yet"
        description="Import your products to help your AI understand context"
        action={<ImportProductsMenu organizationId={organizationId} />}
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={products}
      getRowId={(row) => row.id}
      header={
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <ProductSearch />
          <div className="flex items-center gap-3">
            <ImportProductsMenu organizationId={organizationId} />
          </div>
        </div>
      }
      emptyState={
        searchQuery
          ? {
              title: 'No matching products found',
              description: 'Try adjusting your search terms',
              isFiltered: true,
            }
          : undefined
      }
      pagination={{
        total,
        pageSize,
        hasNextPage,
        clientSide: false,
      }}
      currentPage={currentPage}
    />
  );
}
