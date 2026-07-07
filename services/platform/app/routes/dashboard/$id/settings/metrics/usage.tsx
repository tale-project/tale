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
import { api } from '@/convex/_generated/api';

export const searchSchema = metricsPeriodSearchSchema;

export const Route = createFileRoute('/dashboard/$id/settings/metrics/usage')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    periodDays: parseMetricsPeriodDays(search.period),
  }),
  loader: ({ context, params, deps }) =>
    ensureConvexQuery(context, api.governance.queries.getOrgUsageMetrics, {
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
    <SettingsPage>
      <UsageMetricsPage
        organizationId={organizationId}
        periodDays={periodDays}
        onChangePeriod={handleChangePeriod}
      />
    </SettingsPage>
  );
}
