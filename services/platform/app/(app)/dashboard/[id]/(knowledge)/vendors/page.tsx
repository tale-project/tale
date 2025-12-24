import VendorsTable from './vendors-table';
import { Suspense } from 'react';
import {
  DataTableSkeleton,
  DataTableEmptyState,
} from '@/components/ui/data-table';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { Store } from 'lucide-react';
import ImportVendorsMenu from './import-vendors-menu';
import { getT } from '@/lib/i18n/server';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page: string;
    query?: string;
    size?: string;
    source?: string;
    locale?: string;
  }>;
}

/** Skeleton for the vendors table with header and rows - matches vendors-table.tsx column sizes */
async function VendorsSkeleton() {
  const { t } = await getT('tables');
  return (
    <DataTableSkeleton
      rows={10}
      columns={[
        { header: t('headers.name') }, // No size = expands to fill remaining space
        { header: t('headers.source'), size: 140 },
        { header: '', size: 100 },
        { header: t('headers.created'), size: 140 },
        { isAction: true, size: 140 },
      ]}
      showHeader
      showFilters
    />
  );
}

/** Empty state shown when org has no vendors - avoids unnecessary skeleton */
async function VendorsEmptyState({ organizationId }: { organizationId: string }) {
  const { t } = await getT('emptyStates');
  return (
    <DataTableEmptyState
      icon={Store}
      title={t('vendors.title')}
      description={t('vendors.description')}
      action={<ImportVendorsMenu organizationId={organizationId} />}
    />
  );
}

interface VendorsContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page: string;
    query?: string;
    size?: string;
    source?: string;
    locale?: string;
  }>;
}

async function VendorsContent({ params, searchParams }: VendorsContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;
  const resolvedSearchParams = await searchParams;

  const currentPage = resolvedSearchParams.page
    ? parseInt(resolvedSearchParams.page)
    : 1;

  // Get page size from search params (default to 10)
  const pageSize = resolvedSearchParams.size
    ? Number.parseInt(resolvedSearchParams.size)
    : 10;

  // Get search term from search params
  const searchTerm = resolvedSearchParams.query;

  // Get source and locale filters
  const sourceFilters = resolvedSearchParams.source?.split(',').filter(Boolean);
  const localeFilters = resolvedSearchParams.locale?.split(',').filter(Boolean);

  // Preload vendors for SSR + real-time reactivity on client
  const preloadedVendors = await preloadQuery(
    api.vendors.getVendors,
    {
      organizationId,
      paginationOpts: {
        numItems: pageSize,
        cursor: null,
      },
      source: sourceFilters,
      locale: localeFilters,
      searchTerm,
    },
    { token },
  );

  return (
    <VendorsTable
      organizationId={organizationId}
      currentPage={currentPage}
      pageSize={pageSize}
      searchTerm={searchTerm}
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
  const { query, source, locale } = await searchParams;

  // Two-phase loading: check if vendors exist before showing skeleton
  // If no vendors and no filters active, show empty state directly
  const hasActiveFilters = query?.trim() || source || locale;

  if (!hasActiveFilters) {
    const hasVendors = await fetchQuery(
      api.vendors.hasVendors,
      { organizationId },
      { token },
    );

    if (!hasVendors) {
      return <VendorsEmptyState organizationId={organizationId} />;
    }
  }

  const skeletonFallback = await Promise.resolve(<VendorsSkeleton />);

  return (
    <Suspense fallback={skeletonFallback}>
      <VendorsContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
