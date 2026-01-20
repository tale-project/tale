import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { z } from 'zod';
import { api } from '@/convex/_generated/api';
import { WebsitesTable } from '@/app/features/websites/components/websites-table';
import { WebsitesTableSkeleton } from '@/app/features/websites/components/websites-table-skeleton';
import { WebsitesEmptyState } from '@/app/features/websites/components/websites-empty-state';

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
  const websites = useQuery(api.websites.queries.getAllWebsites, {
    organizationId,
  });

  if (websites === undefined) {
    return <WebsitesTableSkeleton organizationId={organizationId} />;
  }

  if (websites.length === 0) {
    return <WebsitesEmptyState organizationId={organizationId} />;
  }

  return <WebsitesTable organizationId={organizationId} />;
}
