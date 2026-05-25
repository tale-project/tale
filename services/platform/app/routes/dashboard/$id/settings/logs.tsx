import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/$id/settings/logs')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/settings/governance/audit-logs',
      params: { id: params.id },
    });
  },
});
