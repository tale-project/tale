import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/$id/settings/governance/')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/governance/content-models',
      params: { id: params.id },
    });
  },
});
