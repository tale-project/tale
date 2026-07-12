import { createFileRoute, redirect } from '@tanstack/react-router';

// Usage metrics moved under Settings → Metrics (#2382). Kept as a redirect so
// existing links / bookmarks keep working.
export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/usage',
)({
  loader: ({ params, location }) => {
    throw redirect({
      to: '/dashboard/$id/settings/metrics/usage',
      params: { id: params.id },
      search: location.search,
    });
  },
});
