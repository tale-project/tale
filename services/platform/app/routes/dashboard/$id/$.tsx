'use client';

import { createFileRoute } from '@tanstack/react-router';

import { DashboardNotFound } from '@/app/components/layout/dashboard-not-found';
import { seo } from '@/lib/utils/seo';

// Splat catch-all for unmatched paths under `/dashboard/$id`. Renders inside
// the dashboard layout's `<Outlet/>`, so the side-nav rail and shell stay up
// while the content area shows a styled 404 with a recovery link. The `head`
// gives the tab a sensible "Page not found" title instead of falling back to
// the marketing default. Splat routes are matched last, so concrete dashboard
// routes always win.
export const Route = createFileRoute('/dashboard/$id/$')({
  head: () => ({ meta: seo('notFound') }),
  component: DashboardNotFoundRoute,
});

function DashboardNotFoundRoute() {
  const { id: organizationId } = Route.useParams();
  return <DashboardNotFound organizationId={organizationId} />;
}
