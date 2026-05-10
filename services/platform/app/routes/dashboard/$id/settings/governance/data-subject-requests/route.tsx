import { createFileRoute, Outlet } from '@tanstack/react-router';

import { lazyComponent } from '@/lib/utils/lazy-component';

const RequestsListSection = lazyComponent(() =>
  import('@/app/features/settings/governance/data-subject-requests/requests-list-section').then(
    (m) => ({ default: m.RequestsListSection }),
  ),
);

const DsarPolicyEditor = lazyComponent(() =>
  import('@/app/features/settings/governance/components/dsar-policy-editor').then(
    (m) => ({ default: m.DsarPolicyEditor }),
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
    <div className="divide-border flex flex-col divide-y">
      <div id="dsar-policy" className="pb-7">
        <DsarPolicyEditor organizationId={organizationId} />
      </div>
      <div id="dsar-requests" className="pt-7">
        <RequestsListSection organizationId={organizationId} />
      </div>
      <Outlet />
    </div>
  );
}
