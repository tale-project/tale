import { createFileRoute, redirect } from '@tanstack/react-router';

// The per-provider detail page was retired with the AI-backend rewrite — the
// providers index carries every provider as a card now, and a card opens itself
// from the `provider` search param. Forward the slug rather than dropping it, so
// an old deep link still lands on the provider it named.
export const Route = createFileRoute(
  '/dashboard/$id/settings/providers/$providerName',
)({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/providers',
      params: { id: params.id },
      search: { provider: params.providerName },
    });
  },
});
