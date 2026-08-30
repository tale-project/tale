import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { WebsitesTable } from '@/app/features/websites/components/websites-table';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  interval: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/websites')({
  head: () => ({
    meta: seo('websites'),
  }),
  validateSearch: searchSchema,
  loader: ({ context, params }) => {
    prefetchAdaptedQuery(
      context.queryClient,
      'websites/queries:approxCountWebsites',
      {
        organizationId: params.id,
      },
    );
    // Prime the paginated list cache so the first page paints without a
    // skeleton flash on first nav. Args mirror useListWebsitesPaginated's base
    // args (no in-page filters — those resolve via the live subscription).
  },
  component: WebsitesPage,
});

function WebsitesPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  return (
    <WebsitesTable
      organizationId={organizationId}
      status={search.status}
      interval={search.interval}
    />
  );
}
