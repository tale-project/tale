import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/$id/settings/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/organization',
      params: { id: params.id },
    });
  },
});
