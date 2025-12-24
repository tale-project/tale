import { getAuthToken } from '@/lib/auth/auth-server';
import ProductTable from '@/app/(app)/dashboard/[id]/(knowledge)/products/product-table';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import {
  DataTableSkeleton,
  DataTableEmptyState,
} from '@/components/ui/data-table';
import { Package } from 'lucide-react';
import ImportProductsMenu from './import-products-menu';

interface ProductsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; query?: string; size?: string }>;
}

/** Skeleton for the products table with header and rows - matches product-table.tsx column sizes */
function ProductsSkeleton() {
  return (
    <DataTableSkeleton
      rows={10}
      columns={[
        { header: 'Product' }, // No size = expands to fill remaining space
        { header: 'Stock', size: 80 },
        { header: 'Updated', size: 140 },
        { isAction: true, size: 80 },
      ]}
      showHeader
      showFilters
    />
  );
}

/** Empty state shown when org has no products - avoids unnecessary skeleton */
function ProductsEmptyState({ organizationId }: { organizationId: string }) {
  return (
    <DataTableEmptyState
      icon={Package}
      title="No products yet"
      description="Import your products to help your AI understand context"
      action={<ImportProductsMenu organizationId={organizationId} />}
    />
  );
}

interface ProductsContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; query?: string; size?: string }>;
}

async function ProductsContent({ params, searchParams }: ProductsContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;
  const { page, query, size } = await searchParams;

  const currentPage = page ? Number.parseInt(page, 10) : 1;
  const pageSize = size ? Number.parseInt(size, 10) : 10;
  const searchQuery = query?.trim();

  // Preload products for SSR + real-time reactivity on client
  const preloadedProducts = await preloadQuery(
    api.products.getProducts,
    {
      organizationId,
      currentPage,
      searchQuery,
      pageSize,
    },
    { token },
  );

  return (
    <ProductTable
      organizationId={organizationId}
      currentPage={currentPage}
      searchQuery={searchQuery}
      pageSize={pageSize}
      preloadedProducts={preloadedProducts}
    />
  );
}

export default async function ProductsPage({
  params,
  searchParams,
}: ProductsPageProps) {
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;
  const { query } = await searchParams;

  // Two-phase loading: check if products exist before showing skeleton
  // If no products and no search query, show empty state directly
  if (!query?.trim()) {
    const hasProducts = await fetchQuery(
      api.products.hasProducts,
      { organizationId },
      { token },
    );

    if (!hasProducts) {
      return <ProductsEmptyState organizationId={organizationId} />;
    }
  }

  return (
    <Suspense fallback={<ProductsSkeleton />}>
      <ProductsContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
