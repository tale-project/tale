import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  WorkflowMetricsPage,
  type PeriodDays,
} from '@/app/features/automations/metrics/metrics-page';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  period: z.enum(['7', '30', '90']).optional(),
});

export const Route = createFileRoute('/dashboard/$id/automations/metrics')({
  head: () => ({
    meta: seo('automations'),
  }),
  validateSearch: searchSchema,
  component: AutomationsMetricsPage,
});

function AutomationsMetricsPage() {
  const { id: organizationId } = Route.useParams();
  const { period } = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useT('accessDenied');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const periodDays: PeriodDays = period === '7' ? 7 : period === '90' ? 90 : 30;

  const handleChangePeriod = useCallback(
    (next: PeriodDays) => {
      const periodParam: '7' | '30' | '90' =
        next === 7 ? '7' : next === 90 ? '90' : '30';
      void navigate({
        to: '/dashboard/$id/automations/metrics',
        params: { id: organizationId },
        search: { period: periodParam },
        replace: true,
      });
    },
    [navigate, organizationId],
  );

  if (abilityLoading) {
    return <div className="p-4" />;
  }

  if (ability.cannot('write', 'wfDefinitions')) {
    return <AccessDenied message={t('automations')} />;
  }

  return (
    <WorkflowMetricsPage
      organizationId={organizationId}
      periodDays={periodDays}
      onChangePeriod={handleChangePeriod}
    />
  );
}
