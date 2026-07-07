import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { MetricSelect } from '@/app/components/metrics/metric-select';
import { MetricsLayout } from '@/app/components/metrics/metrics-layout';
import {
  metricsPeriodSearchSchema,
  metricsPeriodToParam,
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';
import type { PeriodDays } from '@/app/features/agents/workforce/workforce-dashboard';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';

const WorkforceDashboard = lazyComponent(() =>
  import('@/app/features/agents/workforce/workforce-dashboard').then((mod) => ({
    default: mod.WorkforceDashboard,
  })),
);

export const searchSchema = metricsPeriodSearchSchema;

export const Route = createFileRoute(
  '/dashboard/$id/settings/metrics/workforce',
)({
  validateSearch: searchSchema,
  loader: () => {
    void import('@/app/features/agents/workforce/workforce-dashboard');
  },
  component: WorkforceMetricsRoute,
});

function WorkforceMetricsRoute() {
  const { id: organizationId } = Route.useParams();
  const { period } = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useT('workforce');
  const { t: tMetrics } = useT('metrics');
  const ability = useAbility();
  const canToggle = ability.can('read', 'orgSettings');

  const periodDays: PeriodDays = parseMetricsPeriodDays(period);

  const periodOptions = useMemo(
    () => [
      { value: '7', label: t('period.last7Days') },
      { value: '30', label: t('period.last30Days') },
      { value: '90', label: t('period.last90Days') },
    ],
    [t],
  );

  const handleChangePeriod = useCallback(
    (next: MetricsPeriodDays) => {
      void navigate({
        to: '/dashboard/$id/settings/metrics/workforce',
        params: { id: organizationId },
        search: { period: metricsPeriodToParam(next) },
        replace: true,
      });
    },
    [navigate, organizationId],
  );

  return (
    <SettingsPage>
      <MetricsLayout
        title={tMetrics('workforce.title')}
        description={t('subtitle')}
        toolbar={
          <MetricSelect
            aria-label={t('period.label')}
            options={periodOptions}
            value={String(periodDays)}
            onValueChange={(v) => {
              const next = Number(v);
              if (next === 7 || next === 30 || next === 90)
                handleChangePeriod(next);
            }}
          />
        }
      >
        <WorkforceDashboard
          organizationId={organizationId}
          canToggle={canToggle}
          periodDays={periodDays}
        />
      </MetricsLayout>
    </SettingsPage>
  );
}
