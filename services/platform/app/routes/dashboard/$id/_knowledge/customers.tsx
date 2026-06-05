import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { CustomersTable } from '@/app/features/customers/components/customers-table';
import { primeCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
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
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.customers.queries.approxCountCustomers, {
        organizationId: params.id,
      }),
    );
    // Prime the paginated list cache so the first page paints without a
    // skeleton flash on first nav. Args mirror useListCustomersPaginated's base
    // args (no in-page filters — those resolve via the live subscription).
    void primeCachedPaginatedQuery(
      context.convexQueryClient.convexClient,
      api.customers.queries.listCustomersPaginated,
      { organizationId: params.id },
      { initialNumItems: DEFAULT_TABLE_PAGE_SIZE },
    );
  },
  component: CustomersPage,
});

function CustomersPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  return (
    <CustomersTable
      organizationId={organizationId}
      status={search.status}
      source={search.source}
      locale={search.locale}
    />
  );
}
