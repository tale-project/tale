import CustomersTable from './customers-table';
import { CustomerStatus } from '@/constants/convex-enums';
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
    import?: string;
    status?: string;
    query?: string;
    size?: string;
    source?: string;
    locale?: string;
  }>;
}

/**
 * Skeleton for the customers page that matches the actual layout.
 * Shows search/filter bar skeleton + table skeleton.
 */
function CustomersPageSkeleton() {
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
        headers={['Name', 'Status', 'Source', 'Locale', 'Created', '']}
      />
    </>
  );
}

interface CustomersContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page: string;
    import?: string;
    status?: string;
    query?: string;
    size?: string;
    source?: string;
    locale?: string;
  }>;
}

async function CustomersContent({
  params,
  searchParams,
}: CustomersContentProps) {
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

  // Get status filter from search params (can be comma-separated)
  const statusFilters = resolvedSearchParams.status
    ?.split(',')
    .filter(Boolean) as CustomerStatus[] | undefined;

  // Get source and locale filters
  const sourceFilters = resolvedSearchParams.source?.split(',').filter(Boolean);
  const localeFilters = resolvedSearchParams.locale?.split(',').filter(Boolean);

  // Get search term from search params
  const searchTerm = resolvedSearchParams.query;

  // Prepare query params for pagination that preserves filters
  const baseQueryParams = new URLSearchParams();
  if (resolvedSearchParams.status) {
    baseQueryParams.set('status', resolvedSearchParams.status);
  }
  if (searchTerm) {
    baseQueryParams.set('query', searchTerm);
  }
  if (pageSize !== 10) {
    baseQueryParams.set('size', pageSize.toString());
  }
  const queryString = baseQueryParams.toString();

  // Preload customers for SSR + real-time reactivity on client
  const preloadedCustomers = await preloadQuery(
    api.customers.getCustomers,
    {
      organizationId,
      paginationOpts: {
        numItems: pageSize,
        cursor: null,
      },
      status: statusFilters,
      source: sourceFilters,
      locale: localeFilters,
      searchTerm,
    },
    { token },
  );

  return (
    <CustomersTable
      organizationId={organizationId}
      currentPage={currentPage}
      pageSize={pageSize}
      searchTerm={searchTerm}
      queryParams={queryString}
      preloadedCustomers={preloadedCustomers}
    />
  );
}

export default function CustomersPage({ params, searchParams }: PageProps) {
  return (
    <SuspenseLoader fallback={<CustomersPageSkeleton />}>
      <CustomersContent params={params} searchParams={searchParams} />
    </SuspenseLoader>
  );
}
