import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';
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

export const Route = createFileRoute('/dashboard/$id/websites')({
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

  if (!hasWebsites) {
    return <WebsitesEmptyState organizationId={organizationId} />;
  }

  return (
    <Suspense fallback={<WebsitesTableSkeleton organizationId={organizationId} />}>
      <WebsitesTable organizationId={organizationId} />
    </Suspense>
  );
}
