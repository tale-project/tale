import { createFileRoute, redirect } from '@tanstack/react-router';

// Deployment stores merged into the unified "Data residency" page, which shows
// them read-only or editable per the caller's access. Kept as a redirect so
// existing links / bookmarks keep working.
export const Route = createFileRoute('/dashboard/$id/settings/deployment')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/data-residency',
      params: { id: params.id },
    });
  },
});
