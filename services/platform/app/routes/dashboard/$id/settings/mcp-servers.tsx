import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/$id/settings/mcp-servers')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/mcp',
      params: { id: params.id },
    });
  },
});
