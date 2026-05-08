import { createFileRoute } from '@tanstack/react-router';

import { lazyComponent } from '@/lib/utils/lazy-component';

const ActiveHoldsSection = lazyComponent(() =>
  import('@/app/features/settings/governance/legal-hold/active-holds-section').then(
    (m) => ({ default: m.ActiveHoldsSection }),
  ),
);

const ReleaseRequestsSection = lazyComponent(() =>
  import('@/app/features/settings/governance/legal-hold/release-requests-section').then(
    (m) => ({ default: m.ReleaseRequestsSection }),
  ),
);

const MattersSection = lazyComponent(() =>
  import('@/app/features/settings/governance/legal-hold/matters-section').then(
    (m) => ({ default: m.MattersSection }),
  ),
);

const ReleaseHistorySection = lazyComponent(() =>
  import('@/app/features/settings/governance/legal-hold/release-history-section').then(
    (m) => ({ default: m.ReleaseHistorySection }),
  ),
);

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/legal-hold',
)({
  component: LegalHoldRoute,
});

function LegalHoldRoute() {
  const { id: organizationId } = Route.useParams();

  return (
    <div className="divide-border flex flex-col divide-y">
      <div id="active-holds" className="pb-7">
        <ActiveHoldsSection organizationId={organizationId} />
      </div>
      <div id="release-requests" className="py-7">
        <ReleaseRequestsSection organizationId={organizationId} />
      </div>
      <div id="matters" className="py-7">
        <MattersSection organizationId={organizationId} />
      </div>
      <div id="release-history" className="pt-7">
        <ReleaseHistorySection organizationId={organizationId} />
      </div>
    </div>
  );
}
