import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { VendorsEmptyState } from '@/app/features/vendors/components/vendors-empty-state';
import { VendorsTable } from '@/app/features/vendors/components/vendors-table';
import {
  useApproxVendorCount,
  useListVendorsPaginated,
} from '@/app/features/vendors/hooks/queries';
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
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.vendors.queries.listVendors, {
        organizationId: params.id,
      }),
    );
    await context.queryClient.ensureQueryData(
      convexQuery(api.vendors.queries.approxCountVendors, {
        organizationId: params.id,
      }),
    );
  },
  component: VendorsPage,
});

function VendorsPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  const { data: count } = useApproxVendorCount(organizationId);

  const paginatedResult = useListVendorsPaginated({
    organizationId,
    source: search.source,
    locale: search.locale,
    initialNumItems: 10,
  });

  if (count === 0) {
    return <VendorsEmptyState organizationId={organizationId} />;
  }

  return (
    <VendorsTable
      organizationId={organizationId}
      paginatedResult={paginatedResult}
      source={search.source}
      locale={search.locale}
    />
  );
}
