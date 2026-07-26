import { createFileRoute, redirect } from '@tanstack/react-router';

// The People settings page was split: members live at `/settings/members`
// and the Teams table at `/settings/teams`. This legacy path stays as a
// redirect so existing bookmarks and links keep working.
export const Route = createFileRoute('/dashboard/$id/settings/people')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/members',
      params: { id: params.id },
    });
  },
});
