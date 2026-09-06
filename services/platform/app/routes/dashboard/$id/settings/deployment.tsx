import { createFileRoute, redirect } from '@tanstack/react-router';

// The deployment-stores settings surface is retired; this route only redirects
// to the per-organization "Data residency" page so existing links and
// bookmarks keep working.
export const Route = createFileRoute('/dashboard/$id/settings/deployment')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/data-residency',
      params: { id: params.id },
    });
  },
});
