import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/$id/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/dashboard/$id/chat', params: { id: params.id } });
  },
});
