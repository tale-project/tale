import { getAuthToken } from '@/lib/auth/auth-server';
import { ProductTable } from './components/product-table';
import { ProductTableSkeleton } from './components/product-table-skeleton';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { parseSearchParams, hasActiveFilters } from '@/lib/pagination/parse-search-params';
import { productFilterDefinitions } from './filter-definitions';
import { ProductsEmptyState } from './components/products-empty-state';
import type { Metadata } from 'next';

// This page requires authentication (cookies/connection), so it must be dynamic
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: t('products.title'),
    description: t('products.description'),
  };
}

interface ProductsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}


interface ProductsContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function ProductsContent({ params, searchParams }: ProductsContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;
  const rawSearchParams = await searchParams;

  // Parse filters and pagination using unified system
  // Note: cursor-based pagination doesn't support sorting, so no sorting options needed
  const { filters, pagination } = parseSearchParams(
    rawSearchParams,
    productFilterDefinitions,
  );

  // Valid product status values that the backend accepts
  const VALID_PRODUCT_STATUSES = new Set(['active', 'inactive', 'draft', 'archived']);
  type ProductStatus = 'active' | 'inactive' | 'draft' | 'archived';

  // Preload products for SSR + real-time reactivity on client
  // Using cursor-based pagination to avoid 16MB bytes read limit
  const preloadedProducts = await preloadQuery(
    api.products.getProductsCursor,
    {
      organizationId,
      numItems: pagination.pageSize,
      cursor: null, // First page, no cursor
      searchQuery: filters.query || undefined,
      // Backend currently only supports single status filter - use first valid status
      status: filters.status.find(
        (s): s is ProductStatus => VALID_PRODUCT_STATUSES.has(s),
      ),
    },
    { token },
  );

  return (
    <ProductTable
      organizationId={organizationId}
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
  const rawSearchParams = await searchParams;

  // Parse filters to check for active filters
  const { filters } = parseSearchParams(rawSearchParams, productFilterDefinitions);
  const hasFilters = hasActiveFilters(filters, productFilterDefinitions);

  // Two-phase loading: check if products exist before showing skeleton
  // If no products and no active filters, show empty state directly
  if (!hasFilters) {
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
    <Suspense fallback={<ProductTableSkeleton organizationId={organizationId} />}>
      <ProductsContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
