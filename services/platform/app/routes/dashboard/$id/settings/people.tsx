import { createFileRoute, redirect } from '@tanstack/react-router';

// The People settings page was split: members moved to the Organization page
// and the Teams table now lives at `/settings/teams`. This legacy path stays
// as a redirect so existing bookmarks and links keep working.
export const Route = createFileRoute('/dashboard/$id/settings/people')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/teams',
      params: { id: params.id },
    });
  },
});
