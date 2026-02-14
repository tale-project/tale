import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { WebsitesEmptyState } from '@/app/features/websites/components/websites-empty-state';
import { WebsitesTable } from '@/app/features/websites/components/websites-table';
import { WebsitesTableSkeleton } from '@/app/features/websites/components/websites-table-skeleton';
import { useListWebsitesPaginated } from '@/app/features/websites/hooks/queries';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/websites')({
  validateSearch: searchSchema,
  component: WebsitesPage,
});

function WebsitesPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  const paginatedResult = useListWebsitesPaginated({
    organizationId,
    status: search.status,
    initialNumItems: 20,
  });

  if (paginatedResult.status === 'LoadingFirstPage') {
    return <WebsitesTableSkeleton organizationId={organizationId} />;
  }

  if (
    paginatedResult.status === 'Exhausted' &&
    paginatedResult.results.length === 0
  ) {
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
