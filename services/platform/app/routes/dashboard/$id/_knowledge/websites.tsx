import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { WebsitesEmptyState } from '@/app/features/websites/components/websites-empty-state';
import { WebsitesTable } from '@/app/features/websites/components/websites-table';
import { WebsitesTableSkeleton } from '@/app/features/websites/components/websites-table-skeleton';
import { useListWebsitesPaginated } from '@/app/features/websites/hooks/queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
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
    await context.queryClient.ensureQueryData(
      convexQuery(api.websites.queries.countWebsites, {
        organizationId: params.id,
      }),
    );
  },
  component: WebsitesPage,
});

function WebsitesPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  const { data: count } = useConvexQuery(api.websites.queries.countWebsites, {
    organizationId,
  });

  const paginatedResult = useListWebsitesPaginated({
    organizationId,
    status: search.status,
    initialNumItems: 10,
  });

  const hasServerFilters = !!search.status;

  const isInitialLoading =
    paginatedResult.status === 'LoadingFirstPage' && !hasServerFilters;

  if (count === 0) {
    return <WebsitesEmptyState organizationId={organizationId} />;
  }

  if (isInitialLoading) {
    return (
      <WebsitesTableSkeleton
        organizationId={organizationId}
        rows={Math.min(count ?? 10, 10)}
      />
    );
  }

  return (
    <WebsitesTable
      organizationId={organizationId}
      paginatedResult={paginatedResult}
      status={search.status}
    />
  );
}
