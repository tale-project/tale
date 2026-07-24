import { createFileRoute, redirect } from '@tanstack/react-router';

// The MCP endpoint moved onto the Integrations page. Kept as a redirect so
// existing links / bookmarks keep working.
export const Route = createFileRoute('/dashboard/$id/settings/mcp')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/integrations',
      params: { id: params.id },
    });
  },
});
