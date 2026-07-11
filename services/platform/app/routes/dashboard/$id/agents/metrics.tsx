import { createFileRoute, redirect } from '@tanstack/react-router';

// The workforce dashboard this URL used to render was removed with the
// workforce agents. Old links / bookmarks land on the consolidated
// Settings → Metrics area instead of a 404 (#2382). Without this static
// route the path would fall through to `$agentId` and render "Agent not
// found" for the pseudo-slug "metrics".
export const Route = createFileRoute('/dashboard/$id/agents/metrics')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/metrics/usage',
      params: { id: params.id },
    });
  },
});
