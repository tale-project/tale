import { createFileRoute, redirect } from '@tanstack/react-router';

// Automation metrics moved under Settings → Metrics (#2382). The standalone
// page predates the Apps→Automations rework; this redirect keeps old links /
// bookmarks (including ?period=) working.
export const Route = createFileRoute('/dashboard/$id/automations/metrics')({
  loader: ({ params, location }) => {
    throw redirect({
      to: '/dashboard/$id/settings/metrics/automations',
      params: { id: params.id },
      search: location.search,
    });
  },
});
