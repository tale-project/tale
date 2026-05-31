import { createFileRoute, redirect } from '@tanstack/react-router';

// WebDAV moved under the consolidated "API" section. Kept as a redirect so
// existing links / bookmarks keep working.
export const Route = createFileRoute('/dashboard/$id/settings/webdav')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/api/webdav',
      params: { id: params.id },
    });
  },
});
