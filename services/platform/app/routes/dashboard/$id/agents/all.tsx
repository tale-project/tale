import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AgentsTable } from '@/app/features/agents/components/agents-table';
import { seo } from '@/lib/utils/seo';

// `?folder=<path>` drills into a (possibly nested) agent folder, like the
// automations list. Absent = the root of the agent roster.
const searchSchema = z.object({
  folder: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/agents/all')({
  head: () => ({
    meta: seo('agents'),
  }),
  validateSearch: searchSchema,
  component: AllAgentsPage,
});

function AllAgentsPage() {
  const { id: organizationId } = Route.useParams();
  const { folder } = Route.useSearch();
  return <AgentsTable organizationId={organizationId} currentFolder={folder} />;
}
