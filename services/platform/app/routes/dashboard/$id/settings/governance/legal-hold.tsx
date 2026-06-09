import { createFileRoute } from '@tanstack/react-router';

// These four sections are always rendered together on this single route, so
// splitting each into its own lazy chunk only created a network waterfall and
// staggered pop-in with no payoff (no interaction gate, nothing conditional).
// The route file is already code-split per-route, so static imports keep them
// in the page's own chunk — they load together, once.
import { ActiveHoldsSection } from '@/app/features/settings/governance/legal-hold/active-holds-section';
import { MattersSection } from '@/app/features/settings/governance/legal-hold/matters-section';
import { ReleaseHistorySection } from '@/app/features/settings/governance/legal-hold/release-history-section';
import { ReleaseRequestsSection } from '@/app/features/settings/governance/legal-hold/release-requests-section';

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
