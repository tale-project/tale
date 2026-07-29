import { createFileRoute, redirect } from '@tanstack/react-router';

// The external agent-runtime (tale-daemon) surface was retired with the AI
// backend rewrite; its REST routes re-register when the daemon-runs rebuild
// lands. Kept as a redirect so existing links / bookmarks keep working.
export const Route = createFileRoute('/dashboard/$id/settings/api/runtimes')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/api/rest',
      params: { id: params.id },
    });
  },
});
