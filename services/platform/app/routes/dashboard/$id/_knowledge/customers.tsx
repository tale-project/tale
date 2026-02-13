import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { CustomersEmptyState } from '@/app/features/customers/components/customers-empty-state';
import { CustomersTable } from '@/app/features/customers/components/customers-table';
import { CustomersTableSkeleton } from '@/app/features/customers/components/customers-table-skeleton';
import { useListCustomersPaginated } from '@/app/features/customers/hooks/queries';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  locale: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/customers')({
  validateSearch: searchSchema,
  component: CustomersPage,
});

function CustomersPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  const paginatedResult = useListCustomersPaginated({
    organizationId,
    status: search.status,
    source: search.source,
    locale: search.locale,
    initialNumItems: 20,
  });

  if (paginatedResult.status === 'LoadingFirstPage') {
    return <CustomersTableSkeleton organizationId={organizationId} />;
  }

  if (
    paginatedResult.status === 'Exhausted' &&
    paginatedResult.results.length === 0
  ) {
    return <CustomersEmptyState organizationId={organizationId} />;
  }

  return (
    <CustomersTable
      organizationId={organizationId}
      paginatedResult={paginatedResult}
      status={search.status}
      source={search.source}
      locale={search.locale}
    />
  );
}
