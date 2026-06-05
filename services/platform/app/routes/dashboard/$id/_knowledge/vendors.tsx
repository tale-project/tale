import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { VendorsTable } from '@/app/features/vendors/components/vendors-table';
import { primeCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  query: z.string().optional(),
  source: z.string().optional(),
  locale: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/vendors')({
  head: () => ({
    meta: seo('vendors'),
  }),
  validateSearch: searchSchema,
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.vendors.queries.approxCountVendors, {
        organizationId: params.id,
      }),
    );
    // Prime the paginated list cache so the first page paints without a
    // skeleton flash on first nav. Args mirror useListVendorsPaginated's base
    // args (no in-page filters — those resolve via the live subscription).
    void primeCachedPaginatedQuery(
      context.convexQueryClient.convexClient,
      api.vendors.queries.listVendorsPaginated,
      { organizationId: params.id },
      { initialNumItems: DEFAULT_TABLE_PAGE_SIZE },
    );
  },
  component: VendorsPage,
});

function VendorsPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  return (
    <VendorsTable
      organizationId={organizationId}
      source={search.source}
      locale={search.locale}
    />
  );
}
