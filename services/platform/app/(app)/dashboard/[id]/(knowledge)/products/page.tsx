import { getAuthToken } from '@/lib/auth/auth-server';
import ProductTable from '@/app/(app)/dashboard/[id]/(knowledge)/products/product-table';
import { preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { DataTableSkeleton } from '@/components/ui/data-table';

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

export default function ProductsPage({
  params,
  searchParams,
}: ProductsPageProps) {
  return (
    <Suspense fallback={<ProductsSkeleton />}>
      <ProductsContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
