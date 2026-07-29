import { createFileRoute, redirect } from '@tanstack/react-router';

// What this URL used to serve — the MCP servers catalog — is part of the
// Connectors page now. Kept as a redirect so existing links / bookmarks keep
// working. (The MCP *endpoint* is a separate page, `settings/api/mcp`.)
export const Route = createFileRoute('/dashboard/$id/settings/mcp')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/connectors',
      params: { id: params.id },
    });
  },
});
