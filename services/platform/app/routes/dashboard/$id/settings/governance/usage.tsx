import { createFileRoute } from '@tanstack/react-router';

import { UsageMetricsPage } from '@/app/features/analytics/usage/usage-metrics-page';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { api } from '@/convex/_generated/api';

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/usage',
)({
  // Warm the aggregated metrics with the page's default params (30d / daily /
  // no filters) so a warm navigation paints real cards+chart+tables instead of
  // the skeleton. Bounded query (summary + capped series + top-N), safe to
  // await; never fail the transition on a transient/auth error.
  loader: ({ context, params }) =>
    ensureConvexQuery(context, api.governance.queries.getOrgUsageMetrics, {
      organizationId: params.id,
      periodDays: 30,
      granularity: 'daily',
      agentSlug: undefined,
      model: undefined,
      provider: undefined,
    }).catch((error: unknown) => {
      console.warn('Failed to preload usage metrics', error);
    }),
  component: UsageRoute,
});

function UsageRoute() {
  const { id: organizationId } = Route.useParams();
  return (
    <SettingsPage>
      <UsageMetricsPage organizationId={organizationId} />
    </SettingsPage>
  );
}
