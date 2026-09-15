'use client';

import { PageLayout } from '@tale/ui/page-layout';

import { NotFoundState } from '@/app/components/layout/not-found-state';

interface DashboardNotFoundProps {
  /** Org id used to build the "Back to dashboard" recovery link. */
  organizationId: string;
  className?: string;
}

/**
 * The 404 for an unknown route under `/dashboard/$id`. Renders inside the
 * dashboard layout's `<Outlet/>`, so the side-nav rail and shell stay up; this
 * only fills the content area with the not-found state and its link back to the
 * org dashboard. `PageLayout` is the page container every dashboard page uses:
 * it centres the state in the remaining height and scrolls instead of clipping
 * the recovery link when the viewport is too short to show it.
 */
export function DashboardNotFound({
  organizationId,
  className,
}: DashboardNotFoundProps) {
  return (
    <PageLayout className={className}>
      <NotFoundState href={`/dashboard/${organizationId}`} />
    </PageLayout>
  );
}
