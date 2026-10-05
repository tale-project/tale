import {
  metricsPeriodSearchSchema,
  metricsPeriodToParam,
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@tale/ui/metrics/metrics-period';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import {
  LazyExternalTurnMetricsPage,
  loadExternalTurnMetricsPage,
} from '@/app/features/analytics/lazy-metrics-pages';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ensureOrgSettingsQuery } from '@/app/lib/loader-preload';

export const Route = createFileRoute(
  '/dashboard/$id/settings/metrics/external-turns',
)({
  validateSearch: metricsPeriodSearchSchema,
  loaderDeps: ({ search }) => ({ period: search.period ?? '30' }),
  loader: ({ context, params, deps }) => {
    void loadExternalTurnMetricsPage();
    return ensureOrgSettingsQuery(
      context,
      params.id,
      'sandbox/session_queries_public:getExternalTurnMetrics',
      {
        organizationId: params.id,
        periodDays: parseMetricsPeriodDays(deps.period),
      },
    ).catch((error: unknown) => {
      console.warn('Failed to preload external-turn metrics', error);
    });
  },
  component: ExternalTurnsRoute,
});

function ExternalTurnsRoute() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const periodDays = parseMetricsPeriodDays(search.period);

  const onChangePeriod = useCallback(
    (next: MetricsPeriodDays) => {
      void navigate({
        to: '/dashboard/$id/settings/metrics/external-turns',
        params: { id: organizationId },
        search: (prev) => ({
          ...prev,
          period: next === 30 ? undefined : metricsPeriodToParam(next),
        }),
        replace: true,
      });
    },
    [navigate, organizationId],
  );

  return (
    <SettingsPage fullWidth>
      <LazyExternalTurnMetricsPage
        organizationId={organizationId}
        periodDays={periodDays}
        onChangePeriod={onChangePeriod}
      />
    </SettingsPage>
  );
}
