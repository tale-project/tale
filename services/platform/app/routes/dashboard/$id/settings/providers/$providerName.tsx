import { createFileRoute, redirect } from '@tanstack/react-router';

// The per-provider detail page was retired with the AI-backend rewrite — the
// providers index now carries every connector. Kept as a redirect so old
// deep links keep resolving.
export const Route = createFileRoute(
  '/dashboard/$id/settings/providers/$providerName',
)({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/providers',
      params: { id: params.id },
    });
  },
});
