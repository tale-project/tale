import VendorsTable from './vendors-table';
import { Suspense } from 'react';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';

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
function VendorsSkeleton() {
  return (
    <DataTableSkeleton
      rows={10}
      columns={[
        { header: 'Name' }, // No size = expands to fill remaining space
        { header: 'Source', size: 140 },
        { header: '', size: 100 },
        { header: 'Created', size: 140 },
        { isAction: true, size: 140 },
      ]}
      showHeader
      showFilters
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

export default function VendorsPage({ params, searchParams }: PageProps) {
  return (
    <Suspense fallback={<VendorsSkeleton />}>
      <VendorsContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
