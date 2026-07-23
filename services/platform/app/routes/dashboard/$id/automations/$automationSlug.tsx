import { createFileRoute, Outlet } from '@tanstack/react-router';

import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug',
)({
  head: () => ({ meta: seo('automation') }),
  component: () => <Outlet />,
});
