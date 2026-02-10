import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/$id/settings/custom-agents')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/custom-agents',
      params: { id: params.id },
    });
  },
});
