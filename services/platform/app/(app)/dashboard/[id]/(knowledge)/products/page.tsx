import { getAuthToken } from '@/lib/auth/auth-server';
import ProductTable from '@/app/(app)/dashboard/[id]/(knowledge)/products/product-table';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { SuspenseLoader } from '@/components/suspense-loader';
import { redirect } from 'next/navigation';
import { TableSkeleton } from '@/components/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

interface ProductsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; query?: string; size?: string }>;
}

/**
 * Skeleton for the products page that matches the actual layout.
 */
function ProductsPageSkeleton() {
  return (
    <>
      {/* Search bar skeleton */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <Skeleton className="h-10 w-64 rounded-md" />
        <Skeleton className="h-10 w-32 rounded-md" />
      </div>

      {/* Table skeleton */}
      <TableSkeleton
        rows={10}
        headers={['Product', 'SKU', 'Price', 'Status', 'Created', '']}
      />
    </>
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

  // Use server action to fetch products
  const { products, total, hasNextPage } = await fetchQuery(
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
      products={products}
      total={total}
      currentPage={currentPage}
      hasNextPage={hasNextPage}
      searchQuery={searchQuery}
      pageSize={pageSize}
    />
  );
}

export default function ProductsPage({
  params,
  searchParams,
}: ProductsPageProps) {
  return (
    <SuspenseLoader fallback={<ProductsPageSkeleton />}>
      <ProductsContent params={params} searchParams={searchParams} />
    </SuspenseLoader>
  );
}
