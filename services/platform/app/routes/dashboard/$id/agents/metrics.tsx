import { createFileRoute, redirect } from '@tanstack/react-router';

// Workforce metrics moved under Settings → Metrics. Kept as a redirect so
// existing links / bookmarks (including ?period=) keep working.
export const Route = createFileRoute('/dashboard/$id/agents/metrics')({
  loader: ({ params, location }) => {
    throw redirect({
      to: '/dashboard/$id/settings/metrics/workforce',
      params: { id: params.id },
      search: location.search,
    });
  },
});
