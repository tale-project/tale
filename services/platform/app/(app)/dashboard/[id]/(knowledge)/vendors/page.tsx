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
import { parseSearchParams, hasActiveFilters } from '@/lib/pagination';
import { vendorFilterDefinitions } from './filter-definitions';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

  const skeletonFallback = await Promise.resolve(<VendorsSkeleton />);

  return (
    <Suspense fallback={skeletonFallback}>
      <VendorsContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
