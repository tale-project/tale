import { createFileRoute, Outlet } from '@tanstack/react-router';

// Both sections always render together on this single route; per-section lazy
// chunks only added a waterfall + pop-in. The route is already code-split, so
// static imports keep them in the page's own chunk (load together, once).
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { DsarPolicyEditor } from '@/app/features/settings/governance/components/dsar-policy-editor';
import { RequestsListSection } from '@/app/features/settings/governance/data-subject-requests/requests-list-section';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { api } from '@/convex/_generated/api';

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
    // `fullWidth`: `RequestsListSection`'s table declares an explicit ~940px
    // column-size floor, wider than the `max-w-3xl` other settings pages
    // standardized on (#2567).
    <SettingsPage fullWidth>
      <div id="dsar-policy">
        <DsarPolicyEditor organizationId={organizationId} />
      </div>
      <div id="dsar-requests">
        <RequestsListSection organizationId={organizationId} />
      </div>
      <Outlet />
    </SettingsPage>
  );
}
