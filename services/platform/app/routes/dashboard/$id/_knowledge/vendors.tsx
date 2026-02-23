import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { VendorsTable } from '@/app/features/vendors/components/vendors-table';
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
  pendingComponent: () => null,
  pendingMs: 0,
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

  return (
    <VendorsTable
      organizationId={organizationId}
      source={search.source}
      locale={search.locale}
    />
  );
}
