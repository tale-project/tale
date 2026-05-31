import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/$id/settings/api/')({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/api/rest',
      params: { id: params.id },
    });
  },
});
