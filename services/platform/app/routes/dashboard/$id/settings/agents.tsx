import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/$id/settings/agents')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/agents',
      params: { id: params.id },
    });
  },
});
