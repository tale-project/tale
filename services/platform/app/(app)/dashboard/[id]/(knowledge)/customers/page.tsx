import { CustomersTable } from './components/customers-table';
import { CustomersTableSkeleton } from './components/customers-table-skeleton';
import { Suspense } from 'react';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { parseSearchParams, hasActiveFilters } from '@/lib/pagination/parse-search-params';
import { customerFilterDefinitions } from './filter-definitions';
import { CustomersEmptyState } from './components/customers-empty-state';
import type { Metadata } from 'next';

// This page requires authentication (cookies/connection), so it must be dynamic
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: t('customers.title'),
    description: t('customers.description'),
  };
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
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

  // Parse filters from URL using unified utility
  const { filters } = parseSearchParams(
    resolvedSearchParams,
    customerFilterDefinitions,
  );

  // Preload customers with cursor-based pagination for SSR + real-time reactivity
  const preloadedCustomers = await preloadQuery(
    api.customers.getCustomers,
    {
      organizationId,
      paginationOpts: {
        numItems: 20,
        cursor: null, // First page, no cursor
      },
      searchTerm: filters.query || undefined,
      // Cast status to the expected type
      status: filters.status.length > 0
        ? (filters.status as Array<'active' | 'churned' | 'potential'>)
        : undefined,
      source: filters.source.length > 0 ? filters.source : undefined,
      locale: filters.locale.length > 0 ? filters.locale : undefined,
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

  return (
    <Suspense fallback={<CustomersTableSkeleton organizationId={organizationId} />}>
      <CustomersContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
