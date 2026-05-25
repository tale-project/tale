import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/$id/settings/teams')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/people',
      params: { id: params.id },
      search: { tab: 'teams' },
    });
  },
});
