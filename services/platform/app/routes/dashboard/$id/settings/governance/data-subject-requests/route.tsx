import { createFileRoute, Outlet } from '@tanstack/react-router';

import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { api } from '@/convex/_generated/api';
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
  // Warm the single-row DSAR policy the editor at the top of this page gates
  // on, so it paints its real values on first render (no skeleton flash). The
  // requests list is a paginated query and stays on its own loading path.
  loader: ({ context, params }) =>
    ensureConvexQuery(context, api.governance.dsar_policy.getDsarPolicyForUi, {
      organizationId: params.id,
    }).catch((error: unknown) => {
      console.warn('Failed to preload DSAR policy', error);
    }),
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
