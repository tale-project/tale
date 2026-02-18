import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { WebsitesEmptyState } from '@/app/features/websites/components/websites-empty-state';
import { WebsitesTable } from '@/app/features/websites/components/websites-table';
import {
  useApproxWebsiteCount,
  useListWebsitesPaginated,
} from '@/app/features/websites/hooks/queries';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/websites')({
  head: () => ({
    meta: seo('websites'),
  }),
  validateSearch: searchSchema,
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.websites.queries.listWebsites, {
        organizationId: params.id,
      }),
    );
    await context.queryClient.ensureQueryData(
      convexQuery(api.websites.queries.approxCountWebsites, {
        organizationId: params.id,
      }),
    );
  },
  component: WebsitesPage,
});

function WebsitesPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  const { data: count } = useApproxWebsiteCount(organizationId);

  const paginatedResult = useListWebsitesPaginated({
    organizationId,
    status: search.status,
    initialNumItems: 10,
  });

  if (count === 0) {
    return <WebsitesEmptyState organizationId={organizationId} />;
  }

  return (
    <WebsitesTable
      organizationId={organizationId}
      paginatedResult={paginatedResult}
      status={search.status}
    />
  );
}
