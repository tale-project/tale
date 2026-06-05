import { createFileRoute } from '@tanstack/react-router';

import { AgentsTable } from '@/app/features/agents/components/agents-table';
import { configKeys } from '@/app/hooks/config-query-keys';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/')({
  head: () => ({
    meta: seo('agents'),
  }),
  loader: ({ context, params }) => {
    // Warm the agents list (filesystem-backed action) so the table paints
    // without a skeleton on first nav. Mirrors useListAgents's key + args.
    void context.queryClient.prefetchQuery({
      queryKey: configKeys.list('agents', params.id),
      queryFn: () =>
        context.convexQueryClient.convexClient.action(
          api.agents.file_actions.listAgents,
          { organizationId: params.id },
        ),
      staleTime: Infinity,
      retry: false,
    });
  },
  component: AgentsPage,
});

function AgentsPage() {
  const { id: organizationId } = Route.useParams();

  return <AgentsTable organizationId={organizationId} />;
}
