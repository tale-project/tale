import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { WebsitesEmptyState } from '@/app/features/websites/components/websites-empty-state';
import { WebsitesTable } from '@/app/features/websites/components/websites-table';
import { WebsitesTableSkeleton } from '@/app/features/websites/components/websites-table-skeleton';
import { useWebsites } from '@/app/features/websites/hooks/queries';

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
  const { websites, isLoading } = useWebsites(organizationId);

  if (isLoading) {
    return <WebsitesTableSkeleton organizationId={organizationId} />;
  }

  if (!websites || websites.length === 0) {
    return <WebsitesEmptyState organizationId={organizationId} />;
  }

  return <WebsitesTable organizationId={organizationId} websites={websites} />;
}
