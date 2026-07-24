import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import {
  metricsPeriodSearchSchema,
  metricsPeriodToParam,
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';
import { CodingTurnMetricsPage } from '@/app/features/analytics/coding-turns/coding-turns-metrics-page';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { api } from '@/convex/_generated/api';

export const Route = createFileRoute(
  '/dashboard/$id/settings/metrics/coding-turns',
)({
  validateSearch: metricsPeriodSearchSchema,
  loaderDeps: ({ search }) => ({ period: search.period ?? '30' }),
  loader: ({ context, params, deps }) =>
    ensureConvexQuery(
      context,
      api.sandbox.session_queries_public.getCodingTurnMetrics,
      {
        organizationId: params.id,
        periodDays: parseMetricsPeriodDays(deps.period),
      },
    ).catch((error: unknown) => {
      console.warn('Failed to preload coding-turn metrics', error);
    }),
  component: CodingTurnsRoute,
});

function CodingTurnsRoute() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const periodDays = parseMetricsPeriodDays(search.period);

  const onChangePeriod = useCallback(
    (next: MetricsPeriodDays) => {
      void navigate({
        to: '/dashboard/$id/settings/metrics/coding-turns',
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
    <SettingsPage>
      <CodingTurnMetricsPage
        organizationId={organizationId}
        periodDays={periodDays}
        onChangePeriod={onChangePeriod}
      />
    </SettingsPage>
  );
}
