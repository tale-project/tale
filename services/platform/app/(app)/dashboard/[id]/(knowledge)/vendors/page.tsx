import VendorsTable from './vendors-table';
import { SuspenseLoader } from '@/components/suspense-loader';
import { TableSkeleton } from '@/components/skeletons';
import { Skeleton } from '@/components/ui/skeleton';
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
    <>
      {/* Search and filter bar skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-64 rounded-md" />
          <Skeleton className="h-10 w-24 rounded-md" />
        </div>
        <Skeleton className="h-10 w-32 rounded-md" />
      </div>

      {/* Table skeleton */}
      <TableSkeleton
        rows={10}
        headers={['Name', 'Email', 'Source', 'Locale', 'Created', '']}
      />
    </>
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

  // Prepare query params for pagination that preserves filters
  const baseQueryParams = new URLSearchParams();
  if (searchTerm) {
    baseQueryParams.set('query', searchTerm);
  }
  if (resolvedSearchParams.source) {
    baseQueryParams.set('source', resolvedSearchParams.source);
  }
  if (resolvedSearchParams.locale) {
    baseQueryParams.set('locale', resolvedSearchParams.locale);
  }
  if (pageSize !== 10) {
    baseQueryParams.set('size', pageSize.toString());
  }
  const queryString = baseQueryParams.toString();

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
      queryParams={queryString}
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
