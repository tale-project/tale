import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
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
  const hasWebsites = useQuery(api.websites.queries.hasWebsites, {
    organizationId,
  });

  if (hasWebsites === undefined) {
    return <WebsitesTableSkeleton organizationId={organizationId} />;
  }

  if (hasWebsites === false) {
    return <WebsitesEmptyState organizationId={organizationId} />;
  }

  return <WebsitesTable organizationId={organizationId} />;
}
