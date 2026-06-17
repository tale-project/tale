import { createFileRoute } from '@tanstack/react-router';

import { AgentsTable } from '@/app/features/agents/components/agents-table';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/')({
  head: () => ({
    meta: seo('agents'),
  }),
  // No loader prefetch: the filesystem-backed `listAgents` action requires auth,
  // and a route loader runs BEFORE the Convex WS auth handshake — on a cold load
  // it fired unauthenticated and logged `UNAUTHENTICATED` on every nav. The
  // parent dashboard layout already warms this list once auth is ready
  // (`prewarmConfigCatalog(... listAgents)`), and `useListAgents` is auth-gated,
  // so the table still paints warm on real navigations without the racing fetch.
  component: AgentsPage,
});

function AgentsPage() {
  const { id: organizationId } = Route.useParams();

  return <AgentsTable organizationId={organizationId} />;
}
