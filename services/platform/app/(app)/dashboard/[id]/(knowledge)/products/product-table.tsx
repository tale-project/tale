'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import ProductImage from './product-image';
import Pagination from '@/components/ui/pagination';
import { Package } from 'lucide-react';
import { useParams } from 'next/navigation';
import ProductSearch from './product-search';
import { formatDate } from '@/lib/utils/date/format';
import { Button } from '../../../../../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical, ExternalLink } from 'lucide-react';
import ImportProductsMenu from './import-products-menu';
import ProductActions from './product-actions';

export interface ProductTableProps {
  products: Array<{
    id: string;
    name: string;
    description?: string;
    imageUrl?: string;
    stock?: number;
    lastUpdated: number;
    metadata?: Record<string, unknown>;
  }>;
  total: number;
  currentPage: number;
  hasNextPage: boolean;
  searchQuery?: string;
  pageSize?: number;
}

export default function ProductTable({
  products,
  total,
  currentPage,
  hasNextPage,
  searchQuery,
  pageSize = 10,
}: ProductTableProps) {
  const params = useParams();
  const organizationId = params.id as string;

  const emptyProducts = products.length === 0 && !searchQuery;

  if (emptyProducts) {
    return (
      <div className="grid place-items-center flex-[1_1_0] ring-1 ring-border rounded-xl p-4">
        <div className="text-center max-w-[24rem] flex flex-col items-center">
          <Package className="size-6 text-secondary mb-5" />
          <div className="text-lg font-semibold leading-tight mb-2">
            No products yet
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            Import your products to help your AI understand context
          </p>
          <ImportProductsMenu organizationId={organizationId} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search and Import Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <ProductSearch />
        <div className="flex items-center gap-3">
          <ImportProductsMenu organizationId={organizationId} />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="bg-secondary/20 hover:bg-secondary/20">
            <TableHead className="w-[25rem] font-medium text-muted-foreground">
              Product
            </TableHead>
            <TableHead className="font-medium text-muted-foreground">
              Description
            </TableHead>
            <TableHead className="w-[80px] font-medium text-muted-foreground">
              Stock
            </TableHead>
            <TableHead className="w-[140px] font-medium text-muted-foreground text-right">
              Updated
            </TableHead>
            <TableHead className="w-[80px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.id} className="h-[60px]">
              <TableCell>
                <div className="flex items-center gap-3">
                  <ProductImage
                    images={product.imageUrl ? [product.imageUrl] : []}
                    productName={product.name}
                    className="size-8 rounded shrink-0"
                  />
                  <span className="font-medium text-sm text-foreground">
                    {product.name}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="max-w-sm truncate text-xs text-muted-foreground">
                  {product.description ? `"${product.description}"` : '-'}
                </div>
              </TableCell>
              <TableCell>
                <span
                  className={`text-xs ${
                    product.stock === 0
                      ? 'text-red-600'
                      : 'text-muted-foreground'
                  }`}
                >
                  {product.stock !== undefined ? product.stock : '-'}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <span className="text-xs text-muted-foreground">
                  {formatDate(new Date(product.lastUpdated), {
                    preset: 'short',
                  })}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="size-4 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[160px]">
                      <ProductActions product={product} />
                      {typeof product.metadata?.url === 'string' && (
                        <DropdownMenuItem asChild>
                          <a
                            href={product.metadata.url}
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Pagination */}
      <Pagination
        total={total}
        currentPage={currentPage}
        hasNextPage={hasNextPage}
        pageSize={pageSize}
      />

      {/* Empty search results */}
      {products.length === 0 && searchQuery && (
        <div className="text-center py-12 bg-secondary/20 rounded-lg mt-4">
          <h3 className="text-lg font-medium text-muted-foreground mb-2">
            No matching products found
          </h3>
          <p className="text-muted-foreground mb-4">
            Try adjusting your search terms
          </p>
        </div>
      )}
    </div>
  );
}
