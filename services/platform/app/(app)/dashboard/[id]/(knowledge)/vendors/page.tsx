import VendorsTable from './vendors-table';
import { SuspenseLoader } from '@/components/suspense-loader';
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

/**
 * Skeleton for the vendors page that matches the actual layout.
 */
function VendorsPageSkeleton() {
  return (
    <DataTableSkeleton
      rows={10}
      columns={[
        { header: 'Name', width: 'w-32' },
        { header: 'Email', width: 'w-32' },
        { header: 'Source', width: 'w-24' },
        { header: 'Locale', width: 'w-20' },
        { header: 'Created', width: 'w-24' },
        { isAction: true },
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
    <SuspenseLoader fallback={<VendorsPageSkeleton />}>
      <VendorsContent params={params} searchParams={searchParams} />
    </SuspenseLoader>
  );
}
