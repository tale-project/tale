import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  metricsPeriodSearchSchema,
  metricsPeriodToParam,
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';
import { WorkflowMetricsPage } from '@/app/features/automations/metrics/metrics-page';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute(
  '/dashboard/$id/settings/metrics/automations',
)({
  validateSearch: metricsPeriodSearchSchema,
  component: AutomationsMetricsRoute,
});

function AutomationsMetricsRoute() {
  const { id: organizationId } = Route.useParams();
  const { period } = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useT('accessDenied');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const periodDays: MetricsPeriodDays = parseMetricsPeriodDays(period);

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

  if (abilityLoading) {
    return (
      <Skeletonize loading className="p-4">
        <SkeletonBox fullWidth>
          <div className="h-9 w-full rounded-md" />
        </SkeletonBox>
      </Skeletonize>
    );
  }

  if (ability.cannot('read', 'wfDefinitions')) {
    return <AccessDenied message={t('automations')} />;
  }

  return (
    // `fullWidth`: the page hosts a two-thirds/one-third chart grid plus a
    // six-column runs `DataTable` — both need more than the `max-w-3xl`
    // standard settings measure (#2567).
    <SettingsPage fullWidth>
      <WorkflowMetricsPage
        organizationId={organizationId}
        periodDays={periodDays}
        onChangePeriod={handleChangePeriod}
      />
    </SettingsPage>
  );
}
