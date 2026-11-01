import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { WebsitesTable } from '@/app/features/websites/components/websites-table';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import {
  prefetchAdaptedPaginatedQuery,
  prefetchAdaptedQuery,
} from '@/app/lib/backend/prefetch';
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
    // Prime the first page of the list, under the key the table reads, so a
    // first visit paints its rows without skeleton rows. The tab strip preloads
    // this route as it renders, so the page is usually in the cache before the
    // tab is clicked. The args are useListWebsitesPaginated's on a visit with
    // no filter in the URL, which is how a tab opens.
    prefetchAdaptedPaginatedQuery(
      context.queryClient,
      'websites/queries:listWebsitesPaginated',
      { organizationId: params.id },
      DEFAULT_TABLE_PAGE_SIZE,
    );
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
