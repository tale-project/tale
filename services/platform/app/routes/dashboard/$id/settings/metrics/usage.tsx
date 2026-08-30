import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import {
  metricsPeriodSearchSchema,
  metricsPeriodToParam,
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';
import { UsageMetricsPage } from '@/app/features/analytics/usage/usage-metrics-page';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ensureConvexQuery } from '@/app/lib/loader-preload';

export const Route = createFileRoute('/dashboard/$id/settings/metrics/usage')({
  validateSearch: metricsPeriodSearchSchema,
  loaderDeps: ({ search }) => ({
    periodDays: parseMetricsPeriodDays(search.period),
  }),
  // Warm the aggregated metrics with the page's first-paint params (deep-linked
  // period / daily / no filters) so a warm navigation paints real
  // cards+chart+tables instead of the skeleton. Bounded query (summary +
  // capped series + top-N), safe to await; never fail the transition on a
  // transient/auth error.
  loader: ({ context, params, deps }) =>
    ensureConvexQuery(context, 'governance/queries:getOrgUsageMetrics', {
      organizationId: params.id,
      periodDays: deps.periodDays,
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
  const { period } = Route.useSearch();
  const navigate = useNavigate();

  const periodDays = parseMetricsPeriodDays(period);

  const handleChangePeriod = useCallback(
    (next: MetricsPeriodDays) => {
      void navigate({
        to: '/dashboard/$id/settings/metrics/usage',
        params: { id: organizationId },
        search: { period: metricsPeriodToParam(next) },
        replace: true,
      });
    },
    [navigate, organizationId],
  );

  return (
    // `fullWidth`: `UsersTable`'s columns declare an explicit ~900px
    // size floor, wider than the `max-w-3xl` other settings pages
    // standardized on (#2567).
    <SettingsPage fullWidth>
      <UsageMetricsPage
        organizationId={organizationId}
        periodDays={periodDays}
        onChangePeriod={handleChangePeriod}
      />
    </SettingsPage>
  );
}
