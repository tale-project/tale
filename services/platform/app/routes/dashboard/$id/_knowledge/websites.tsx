import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { WebsitesEmptyState } from '@/app/features/websites/components/websites-empty-state';
import { WebsitesTable } from '@/app/features/websites/components/websites-table';
import { WebsitesTableSkeleton } from '@/app/features/websites/components/websites-table-skeleton';
import { api } from '@/convex/_generated/api';

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
  const { data: hasWebsites, isLoading } = useQuery(
    convexQuery(api.websites.queries.hasWebsites, { organizationId }),
  );

  if (isLoading) {
    return <WebsitesTableSkeleton organizationId={organizationId} />;
  }

  if (!hasWebsites) {
    return <WebsitesEmptyState organizationId={organizationId} />;
  }

  return <WebsitesTable organizationId={organizationId} />;
}
