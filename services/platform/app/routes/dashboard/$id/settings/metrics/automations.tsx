import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import {
  metricsPeriodSearchSchema,
  metricsPeriodToParam,
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';
import { AutomationMetricsPage } from '@/app/features/analytics/automations/automation-metrics-page';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { automationSlugToParam } from '@/lib/automations/slug';

export const Route = createFileRoute(
  '/dashboard/$id/settings/metrics/automations',
)({
  validateSearch: metricsPeriodSearchSchema,
  loaderDeps: ({ search }) => ({
    periodDays: parseMetricsPeriodDays(search.period),
  }),
  // Warm the aggregated metrics with the page's first-paint params (deep-linked
  // period) so a warm navigation paints real cards+charts+table instead of the
  // skeleton. Bounded query (summary + capped series + top-N), safe to await;
  // never fail the transition on a transient/auth error.
  loader: ({ context, params, deps }) =>
    ensureConvexQuery(context, 'automations/queries:getOrgAutomationMetrics', {
      organizationId: params.id,
      periodDays: deps.periodDays,
    }).catch((error: unknown) => {
      console.warn('Failed to preload automation metrics', error);
    }),
  component: AutomationsMetricsRoute,
});

function AutomationsMetricsRoute() {
  const { id: organizationId } = Route.useParams();
  const { period } = Route.useSearch();
  const navigate = useNavigate();

  const periodDays = parseMetricsPeriodDays(period);

  const handleChangePeriod = useCallback(
    (next: MetricsPeriodDays) => {
      void navigate({
        to: '/dashboard/$id/settings/metrics/automations',
        params: { id: organizationId },
        search: { period: metricsPeriodToParam(next) },
        replace: true,
      });
    },
    [navigate, organizationId],
  );

  const handleSelectAutomation = useCallback(
    (name: string) => {
      void navigate({
        to: '/dashboard/$id/automations/$automationSlug',
        params: {
          id: organizationId,
          automationSlug: automationSlugToParam(name),
        },
      });
    },
    [navigate, organizationId],
  );

  return (
    // `fullWidth`: the page hosts a two-thirds/one-third chart grid plus a
    // six-column runs `DataTable` — both need more than the `max-w-3xl`
    // standard settings measure (#2567).
    <SettingsPage fullWidth>
      <AutomationMetricsPage
        organizationId={organizationId}
        periodDays={periodDays}
        onChangePeriod={handleChangePeriod}
        onSelectAutomation={handleSelectAutomation}
      />
    </SettingsPage>
  );
}
