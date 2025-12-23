import CustomersTable from './customers-table';
import { CustomerStatus } from '@/constants/convex-enums';
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
    import?: string;
    status?: string;
    query?: string;
    size?: string;
    source?: string;
    locale?: string;
  }>;
}

/** Skeleton for the customers table with header and rows */
function CustomersSkeleton() {
  return (
    <DataTableSkeleton
      rows={10}
      columns={[
        { header: 'Name', width: 'w-48' },
        { header: 'Status', width: 'w-20' },
        { header: 'Source', width: 'w-24' },
        { header: '', width: 'w-12' },
        { header: 'Created', width: 'w-24' },
        { isAction: true },
      ]}
      showHeader
      showFilters
    />
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
      preloadedCustomers={preloadedCustomers}
    />
  );
}

export default function CustomersPage({ params, searchParams }: PageProps) {
  return (
    <Suspense fallback={<CustomersSkeleton />}>
      <CustomersContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
