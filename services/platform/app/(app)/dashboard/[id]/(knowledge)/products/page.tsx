import { requireAuth, getAuthToken } from '@/lib/auth/auth-server';
import ProductTable from '@/app/(app)/dashboard/[id]/(knowledge)/products/product-table';
import { fetchQuery } from 'convex/nextjs';
import { api } from '@/convex/_generated/api';
import { SuspenseLoader } from '@/components/suspense-loader';
import { redirect } from 'next/navigation';

interface ProductsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; query?: string; size?: string }>;
}

async function ProductsContent({ params, searchParams }: ProductsPageProps) {
  // Get parameters
  const { id: organizationId } = await params;
  await requireAuth();

  // Handle searchParams properly
  const { page, query, size } = await searchParams;

  const currentPage = page ? Number.parseInt(page, 10) : 1;
  const pageSize = size ? Number.parseInt(size, 10) : 10;
  const searchQuery = query?.trim();

  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

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

export default function ProductsPage(props: ProductsPageProps) {
  return (
    <SuspenseLoader>
      <ProductsContent {...props} />
    </SuspenseLoader>
  );
}
