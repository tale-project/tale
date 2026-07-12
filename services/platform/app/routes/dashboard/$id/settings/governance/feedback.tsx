import { createFileRoute, redirect } from '@tanstack/react-router';

// Feedback metrics moved under Settings → Metrics (#2382). Kept as a redirect
// so existing links / bookmarks (including search params) keep working.
export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/feedback',
)({
  loader: ({ params, location }) => {
    throw redirect({
      to: '/dashboard/$id/settings/metrics/feedback',
      params: { id: params.id },
      search: location.search,
    });
  },
});
