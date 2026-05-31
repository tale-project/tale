import { createFileRoute, redirect } from '@tanstack/react-router';

// API keys moved under the consolidated "API" section (REST subpage).
// Kept as a redirect so existing links / bookmarks keep working.
export const Route = createFileRoute('/dashboard/$id/settings/api-keys')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/api/rest',
      params: { id: params.id },
    });
  },
});
