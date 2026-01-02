import { VendorsTable } from './vendors-table';
import { VendorsTableSkeleton } from './vendors-table-skeleton';
import { Suspense } from 'react';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { parseSearchParams, hasActiveFilters } from '@/lib/pagination/parse-search-params';
import { vendorFilterDefinitions } from './filter-definitions';
import { VendorsEmptyState } from './vendors-empty-state';
import type { Metadata } from 'next';

// This page requires authentication (cookies/connection), so it must be dynamic
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: t('vendors.title'),
    description: t('vendors.description'),
  };
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}


interface VendorsContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function VendorsContent({ params, searchParams }: VendorsContentProps) {
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
    vendorFilterDefinitions,
    { defaultSort: '_creationTime', defaultDesc: true },
  );

  // Preload vendors for SSR + real-time reactivity on client
  const preloadedVendors = await preloadQuery(
    api.vendors.listVendors,
    {
      organizationId,
      currentPage: pagination.page,
      pageSize: pagination.pageSize,
      searchTerm: filters.query || undefined,
      source: filters.source.length > 0 ? filters.source : undefined,
      locale: filters.locale.length > 0 ? filters.locale : undefined,
      sortField: sorting[0]?.id,
      sortOrder: sorting[0] ? (sorting[0].desc ? 'desc' : 'asc') : undefined,
    },
    { token },
  );

  return (
    <VendorsTable
      organizationId={organizationId}
      preloadedVendors={preloadedVendors}
    />
  );
}

export default async function VendorsPage({
  params,
  searchParams,
}: PageProps) {
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;
  const rawSearchParams = await searchParams;

  // Parse filters to check for active filters
  const { filters } = parseSearchParams(rawSearchParams, vendorFilterDefinitions);
  const hasFilters = hasActiveFilters(filters, vendorFilterDefinitions);

  // Two-phase loading: check if vendors exist before showing skeleton
  // If no vendors and no filters active, show empty state directly
  if (!hasFilters) {
    const hasVendors = await fetchQuery(
      api.vendors.hasVendors,
      { organizationId },
      { token },
    );

    if (!hasVendors) {
      return <VendorsEmptyState organizationId={organizationId} />;
    }
  }

  return (
    <Suspense fallback={<VendorsTableSkeleton organizationId={organizationId} />}>
      <VendorsContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
