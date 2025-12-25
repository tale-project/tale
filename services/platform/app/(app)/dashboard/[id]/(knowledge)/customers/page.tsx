import CustomersTable from './customers-table';
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
import { parseSearchParams, hasActiveFilters } from '@/lib/pagination';
import { customerFilterDefinitions } from './filter-definitions';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
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
  searchParams: Promise<Record<string, string | undefined>>;
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

  // Parse filters, pagination, and sorting from URL using unified utility
  const { filters, pagination, sorting } = parseSearchParams(
    resolvedSearchParams,
    customerFilterDefinitions,
    { defaultSort: '_creationTime', defaultDesc: true },
  );

  // Preload customers for SSR + real-time reactivity on client
  const preloadedCustomers = await preloadQuery(
    api.customers.listCustomers,
    {
      organizationId,
      currentPage: pagination.page,
      pageSize: pagination.pageSize,
      searchTerm: filters.query || undefined,
      // Cast status to the expected type
      status: filters.status.length > 0
        ? (filters.status as Array<'active' | 'churned' | 'potential'>)
        : undefined,
      source: filters.source.length > 0 ? filters.source : undefined,
      locale: filters.locale.length > 0 ? filters.locale : undefined,
      sortField: sorting[0]?.id,
      sortOrder: sorting[0]?.desc ? 'desc' : 'asc',
    },
    { token },
  );

  return (
    <CustomersTable
      organizationId={organizationId}
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
  const resolvedSearchParams = await searchParams;

  // Parse filters to check if any are active
  const { filters } = parseSearchParams(resolvedSearchParams, customerFilterDefinitions);
  const filtersActive = hasActiveFilters(filters, customerFilterDefinitions);

  // Two-phase loading: check if customers exist before showing skeleton
  // If no customers and no filters active, show empty state directly
  if (!filtersActive) {
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
