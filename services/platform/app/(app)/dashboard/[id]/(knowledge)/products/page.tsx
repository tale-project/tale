import { getAuthToken } from '@/lib/auth/auth-server';
import ProductTable from '@/app/(app)/dashboard/[id]/(knowledge)/products/product-table';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { getT } from '@/lib/i18n/server';
import { parseSearchParams, hasActiveFilters } from '@/lib/pagination';
import { productFilterDefinitions } from './filter-definitions';
import { ProductsEmptyState } from './products-empty-state';
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

/** Skeleton for the products table with header and rows - matches product-table.tsx column sizes */
async function ProductsSkeleton() {
  const { t } = await getT('tables');
  return (
    <DataTableSkeleton
      rows={10}
      columns={[
        { header: t('headers.product'), size: 400 },
        { header: t('headers.description') },
        { header: t('headers.stock'), size: 80 },
        { header: t('headers.updated'), size: 140 },
        { isAction: true, size: 80 },
      ]}
      showHeader
      showFilters
    />
  );
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

  // Parse filters, pagination, and sorting using unified system
  const { filters, pagination, sorting } = parseSearchParams(
    rawSearchParams,
    productFilterDefinitions,
    { defaultSort: 'lastUpdated', defaultDesc: true },
  );

  // Preload products for SSR + real-time reactivity on client
  const preloadedProducts = await preloadQuery(
    api.products.getProducts,
    {
      organizationId,
      currentPage: pagination.page,
      pageSize: pagination.pageSize,
      searchQuery: filters.query || undefined,
      // Backend currently only supports single status filter
      status: filters.status.length === 1
        ? (filters.status[0] as 'active' | 'inactive' | 'draft' | 'archived')
        : undefined,
      sortBy: sorting[0]?.id as 'name' | 'createdAt' | 'lastUpdated' | 'stock' | 'price' | undefined,
      sortOrder: sorting[0] ? (sorting[0].desc ? 'desc' : 'asc') : undefined,
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

  const skeletonFallback = await Promise.resolve(<ProductsSkeleton />);

  return (
    <Suspense fallback={skeletonFallback}>
      <ProductsContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
