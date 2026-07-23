import { createFileRoute, Outlet } from '@tanstack/react-router';

import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents')({
  head: () => ({
    meta: seo('agents'),
  }),
  component: Outlet,
});
