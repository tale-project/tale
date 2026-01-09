import { VendorsTable } from './components/vendors-table';
import { VendorsTableSkeleton } from './components/vendors-table-skeleton';
import { VendorsPageWrapper } from './components/vendors-page-wrapper';
import { Suspense } from 'react';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { parseSearchParams } from '@/lib/pagination/parse-search-params';
import { vendorFilterDefinitions } from './filter-definitions';
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

  // Parse filters from URL using unified system
  const { filters } = parseSearchParams(
    rawSearchParams,
    vendorFilterDefinitions,
  );

  // Preload vendors with cursor-based pagination for SSR + real-time reactivity
  const preloadedVendors = await preloadQuery(
    api.vendors.getVendors,
    {
      organizationId,
      paginationOpts: {
        numItems: 20,
        cursor: null, // First page, no cursor
      },
      searchTerm: filters.query || undefined,
      source: filters.source.length > 0 ? filters.source : undefined,
      locale: filters.locale.length > 0 ? filters.locale : undefined,
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

export default async function VendorsPage({ params, searchParams }: PageProps) {
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;
  const rawSearchParams = await searchParams;

  // Fetch initial hasVendors state for SSR
  // Always fetch to ensure accurate state, regardless of filters
  const initialHasVendors = await fetchQuery(
    api.vendors.hasVendors,
    { organizationId },
    { token },
  );

  return (
    <VendorsPageWrapper
      organizationId={organizationId}
      initialHasVendors={initialHasVendors}
    >
      <Suspense
        fallback={<VendorsTableSkeleton organizationId={organizationId} />}
      >
        <VendorsContent params={params} searchParams={searchParams} />
      </Suspense>
    </VendorsPageWrapper>
  );
}
