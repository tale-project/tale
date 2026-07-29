import { createFileRoute, redirect } from '@tanstack/react-router';

// Straight to the destination rather than hopping through `settings/mcp`:
// two redirects for one stale bookmark is a wasted round trip.
export const Route = createFileRoute('/dashboard/$id/settings/mcp-servers')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/connectors',
      params: { id: params.id },
    });
  },
});
