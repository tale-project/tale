import { createFileRoute, Outlet } from '@tanstack/react-router';

import { lazyComponent } from '@/lib/utils/lazy-component';

const RequestsListSection = lazyComponent(() =>
  import('@/app/features/settings/governance/data-subject-requests/requests-list-section').then(
    (m) => ({ default: m.RequestsListSection }),
  ),
);

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/data-subject-requests',
)({
  component: DataSubjectRequestsRoute,
});

function DataSubjectRequestsRoute() {
  const { id: organizationId } = Route.useParams();

  return (
    <>
      <RequestsListSection organizationId={organizationId} />
      <Outlet />
    </>
  );
}
