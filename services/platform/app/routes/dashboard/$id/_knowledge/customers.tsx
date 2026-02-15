import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { CustomersEmptyState } from '@/app/features/customers/components/customers-empty-state';
import { CustomersTable } from '@/app/features/customers/components/customers-table';
import { CustomersTableSkeleton } from '@/app/features/customers/components/customers-table-skeleton';
import { useListCustomersPaginated } from '@/app/features/customers/hooks/queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  locale: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/customers')({
  head: () => ({
    meta: seo('customers'),
  }),
  validateSearch: searchSchema,
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      convexQuery(api.customers.queries.countCustomers, {
        organizationId: params.id,
      }),
    );
  },
  component: CustomersPage,
});

function CustomersPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  const { data: count } = useConvexQuery(api.customers.queries.countCustomers, {
    organizationId,
  });

  const paginatedResult = useListCustomersPaginated({
    organizationId,
    status: search.status,
    source: search.source,
    locale: search.locale,
    initialNumItems: 20,
  });

  if (count === 0) {
    return <CustomersEmptyState organizationId={organizationId} />;
  }

  const hasServerFilters = !!(search.status || search.source || search.locale);

  const isInitialLoading =
    paginatedResult.status === 'LoadingFirstPage' && !hasServerFilters;

  if (isInitialLoading) {
    return (
      <CustomersTableSkeleton
        organizationId={organizationId}
        rows={Math.min(count ?? 10, 10)}
      />
    );
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
