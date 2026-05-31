import { createFileRoute, redirect } from '@tanstack/react-router';

// MCP moved under the consolidated "API" section. Kept as a redirect so
// existing links / bookmarks keep working.
export const Route = createFileRoute('/dashboard/$id/settings/mcp')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/api/mcp',
      params: { id: params.id },
    });
  },
});
