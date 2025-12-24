import CustomersTable from './customers-table';
import { CustomerStatus } from '@/constants/convex-enums';
import { Suspense } from 'react';
import {
  DataTableSkeleton,
  DataTableEmptyState,
} from '@/components/ui/data-table';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';
import ImportCustomersMenu from './import-customers-menu';
import { getT } from '@/lib/i18n/server';

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

/** Skeleton for the customers table with header and rows - matches customers-table.tsx column sizes */
async function CustomersSkeleton() {
  const { t } = await getT('tables');
  return (
    <DataTableSkeleton
      rows={10}
      columns={[
        { header: t('headers.name') }, // No size = expands to fill remaining space
        { header: t('headers.status'), size: 140 },
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

/** Empty state shown when org has no customers - avoids unnecessary skeleton */
async function CustomersEmptyState({ organizationId }: { organizationId: string }) {
  const { t } = await getT('emptyStates');
  return (
    <DataTableEmptyState
      icon={Users}
      title={t('customers.title')}
      description={t('customers.description')}
      action={<ImportCustomersMenu organizationId={organizationId} />}
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

export default async function CustomersPage({
  params,
  searchParams,
}: PageProps) {
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;
  const { query, status, source, locale } = await searchParams;

  // Two-phase loading: check if customers exist before showing skeleton
  // If no customers and no filters active, show empty state directly
  const hasActiveFilters = query?.trim() || status || source || locale;

  if (!hasActiveFilters) {
    const hasCustomers = await fetchQuery(
      api.customers.hasCustomers,
      { organizationId },
      { token },
    );

    if (!hasCustomers) {
      return <CustomersEmptyState organizationId={organizationId} />;
    }
  }

  const skeletonFallback = await Promise.resolve(<CustomersSkeleton />);

  return (
    <Suspense fallback={skeletonFallback}>
      <CustomersContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
