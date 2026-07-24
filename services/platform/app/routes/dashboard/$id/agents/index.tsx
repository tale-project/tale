import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { useCatalogSync } from '@/app/components/catalog/use-catalog-sync';
import { AgentsTable } from '@/app/features/agents/components/agents-table';
import { seo } from '@/lib/utils/seo';

// `?folder=<path>` drills into a (possibly nested) agent folder. Absent =
// the root of the agent roster.
const searchSchema = z.object({
  folder: z.string().optional(),
});

// The agent roster — the org's list of installed agents. Agents are now
// installed exclusively through automations or the create/upload menu below
// (the standalone Catalog tab was folded in here — "Update from catalog"
// lives in the same action menu as Blank / Upload).
export const Route = createFileRoute('/dashboard/$id/agents/')({
  head: () => ({
    meta: seo('agents'),
  }),
  validateSearch: searchSchema,
  component: AgentsIndexPage,
});

function AgentsIndexPage() {
  const { id: organizationId } = Route.useParams();
  const { folder } = Route.useSearch();
  const queryClient = useQueryClient();
  // "Update from catalog" lives inside the create-agent dropdown (via
  // AgentsTable's `extraMenuItems`), not as a second header button. It
  // refreshes the org's builtin agent files from the built-in catalog.
  const { menuItem: syncItem, dialog: syncDialog } = useCatalogSync({
    organizationId,
    domain: 'agents',
    onSynced: () =>
      queryClient.invalidateQueries({
        queryKey: ['config', 'agents', organizationId],
      }),
  });

  return (
    <AgentsTable
      organizationId={organizationId}
      currentFolder={folder}
      extraMenuItems={syncItem ? [syncItem] : undefined}
      extraDialog={syncDialog}
    />
  );
}
